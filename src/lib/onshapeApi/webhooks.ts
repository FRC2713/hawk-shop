import "virtual:hawk-shop/server-only";

/**
 * Webhook upkeep: keeps one Onshape webhook registered per document whose
 * workspace the app reads, so `POST /api/onshape/webhook` hears about edits
 * (see docs/ONSHAPE.md#webhooks). It runs on evidence, never on a clock:
 *
 * - `ensure(documentId)` runs after every workspace parts read. It registers a
 *   webhook the first time a document is seen and costs one SQLite read after.
 * - `deliverySeen(documentId)` runs for every authenticated delivery.
 * - `workspaceObserved(documentId, elementId, fingerprint)` runs after a
 *   workspace parts read that reached Onshape (not the cache).
 *
 * A repair pass (list the key's webhooks, register again any tracked one that
 * is missing or delivers to an old callback, delete strays that deliver here)
 * runs only on evidence that a webhook is broken: a Part Studio whose parts
 * changed between two upstream reads with no delivery for its document in
 * between, or a callback URL that differs from the one recorded at
 * registration. Passes start at most once per 24 hours, durably, and never
 * block the read that found the evidence.
 *
 * Every call goes through the Onshape gateway, is tallied under its own usage
 * label and obeys the daily ceiling. When webhooks are disabled, none of this
 * calls Onshape. Nothing here throws to its caller: upkeep must never fail a
 * parts read or a delivery.
 */

import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "~/server/db/client";
import { onshapeWebhookUpkeepState, onshapeWebhooks } from "~/server/db/schema";
import {
  ONSHAPE_DOCUMENT_CHANGE_EVENTS,
  ONSHAPE_WEBHOOK_SECRET_PARAM,
  onshapeWebhookCallbackUrl,
  onshapeWebhookSettings,
  type OnshapeWebhookSettings,
} from "~/server/onshape-webhook";
import {
  onshapeBudgetStatus,
  onshapeRead,
  OnshapeRequestError,
  onshapeWrite,
} from "./gateway";

/** The shortest gap between two repair passes. */
export const WEBHOOK_REPAIR_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Why a repair pass ran, as `/onshape` and `/api/onshape/usage` show it. */
export type WebhookRepairReason = "missed-delivery" | "callback-changed";

const UPKEEP_ROW = "default";

const globalForWebhooks = globalThis as unknown as {
  __onshapeWebhookWork?: Map<string, Promise<void>>;
};
/** Registrations and repair passes still running, keyed by document (or "repair"). */
const work = (globalForWebhooks.__onshapeWebhookWork ??= new Map());

/** Resolves once every registration or repair pass started so far has settled. */
export async function onshapeWebhookWork(): Promise<void> {
  while (work.size > 0) await Promise.allSettled([...work.values()]);
}

function track(key: string, run: () => Promise<void>): Promise<void> {
  const pending = work.get(key);
  if (pending) return pending;
  const promise = run()
    .catch((error) => console.error(`[ONSHAPE WEBHOOK] ${key} failed:`, error))
    .finally(() => work.delete(key));
  work.set(key, promise);
  return promise;
}

const filterFor = (documentId: string) =>
  `{$DocumentId} = '${documentId.replace(/'/g, "")}'`;

async function register(
  settings: OnshapeWebhookSettings,
  documentId: string
): Promise<string> {
  const body = await onshapeWrite<{ id?: unknown } | null>({
    label: "webhook-register",
    request: {
      path: "/v6/webhooks",
      body: {
        events: [...ONSHAPE_DOCUMENT_CHANGE_EVENTS],
        filter: filterFor(documentId),
        options: { collapseEvents: false },
        url: onshapeWebhookCallbackUrl(settings),
        isTransient: false,
      },
    },
  });
  if (typeof body?.id !== "string" || !body.id)
    throw new Error("registration returned no webhook id");
  return body.id;
}

type ListedWebhook = { id: string; url?: string };

async function listWebhooks(): Promise<ListedWebhook[]> {
  const hooks: ListedWebhook[] = [];
  let next: string | null = "/v6/webhooks?limit=20";
  for (let page = 0; next && page < 50; page++) {
    const body: {
      items?: { id?: unknown; url?: unknown }[];
      next?: unknown;
    } | null = await onshapeRead({
      label: "webhook-list",
      dedupKey: `webhook-list::${next}`,
      request: { path: next },
    });
    for (const item of body?.items ?? [])
      if (typeof item.id === "string")
        hooks.push({
          id: item.id,
          url: typeof item.url === "string" ? item.url : undefined,
        });
    next = typeof body?.next === "string" && body.next ? body.next : null;
  }
  return hooks;
}

async function deleteWebhook(webhookId: string): Promise<void> {
  try {
    await onshapeWrite({
      label: "webhook-delete",
      responseType: "none",
      request: {
        method: "DELETE",
        path: `/v6/webhooks/${encodeURIComponent(webhookId)}`,
      },
    });
  } catch (error) {
    // Already gone is as good as deleted.
    if (!(error instanceof OnshapeRequestError && error.status === 404))
      throw error;
  }
}

/**
 * A SHA-256 of the callback URL. The URL carries the secret, so only its hash
 * is stored; equal hashes mean the webhook delivers where it should.
 */
function callbackHash(settings: OnshapeWebhookSettings): string {
  return createHash("sha256")
    .update(onshapeWebhookCallbackUrl(settings))
    .digest("hex");
}

type Observation = { fingerprint: string; observedAt: string };
type Observations = Record<string, Observation>;

function parseObservations(raw: string | null): Observations {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Observations) : {};
  } catch {
    return {};
  }
}

/**
 * Observations made before the document's webhook row existed (the first read
 * of a document comes before its registration), saved with the registration.
 */
const unregisteredObservations = new Map<string, Observations>();

function save(
  settings: OnshapeWebhookSettings,
  documentId: string,
  webhookId: string
): void {
  const registered_at = new Date().toISOString();
  const callback_hash = callbackHash(settings);
  const observed = unregisteredObservations.get(documentId);
  unregisteredObservations.delete(documentId);
  db.insert(onshapeWebhooks)
    .values({
      document_id: documentId,
      webhook_id: webhookId,
      registered_at,
      callback_hash,
      observed_part_studios: observed ? JSON.stringify(observed) : null,
    })
    .onConflictDoUpdate({
      target: onshapeWebhooks.document_id,
      set: { webhook_id: webhookId, registered_at, callback_hash },
    })
    .run();
}

function findRow(documentId: string) {
  const [row] = db
    .select()
    .from(onshapeWebhooks)
    .where(eq(onshapeWebhooks.document_id, documentId))
    .limit(1)
    .all();
  return row;
}

/**
 * Compare the row's recorded callback with the current one. A row from before
 * callbacks were recorded adopts the current one: the old daily check kept
 * those webhooks pointed at the configured callback.
 */
function checkCallback(
  settings: OnshapeWebhookSettings,
  row: { document_id: string; callback_hash: string | null }
): void {
  const current = callbackHash(settings);
  if (row.callback_hash === current) return;
  if (row.callback_hash === null) {
    db.update(onshapeWebhooks)
      .set({ callback_hash: current })
      .where(eq(onshapeWebhooks.document_id, row.document_id))
      .run();
    return;
  }
  requestRepair(settings, "callback-changed", row.document_id);
}

/**
 * Make sure `documentId` has a webhook. Called without awaiting after every
 * workspace parts read; a document already in the table costs one SQLite read.
 */
function ensure(documentId: string): Promise<void> {
  const settings = onshapeWebhookSettings();
  if (!settings || !documentId) return Promise.resolve();
  try {
    const known = findRow(documentId);
    if (known) {
      checkCallback(settings, known);
      return Promise.resolve();
    }
  } catch (error) {
    console.error("[ONSHAPE WEBHOOK] lookup failed:", error);
    return Promise.resolve();
  }
  return track(`register:${documentId}`, async () => {
    save(settings, documentId, await register(settings, documentId));
  });
}

/** Record that a delivery for this document arrived. Never throws. */
function deliverySeen(documentId: string): void {
  try {
    db.update(onshapeWebhooks)
      .set({ last_event_at: new Date().toISOString() })
      .where(eq(onshapeWebhooks.document_id, documentId))
      .run();
  } catch (error) {
    console.error("[ONSHAPE WEBHOOK] event record failed:", error);
  }
}

/**
 * A workspace read of one Part Studio reached Onshape and saw parts with this
 * fingerprint. If the fingerprint differs from the previous upstream read's
 * and no delivery for the document arrived since that read, the document
 * changed without its webhook saying so: a repair pass is due. Never throws.
 */
function workspaceObserved(
  documentId: string,
  elementId: string,
  fingerprint: string
): void {
  const settings = onshapeWebhookSettings();
  if (!settings || !documentId) return;
  try {
    const observation = { fingerprint, observedAt: new Date().toISOString() };
    const row = findRow(documentId);
    if (!row) {
      unregisteredObservations.set(documentId, {
        ...unregisteredObservations.get(documentId),
        [elementId]: observation,
      });
      return;
    }
    const observed = parseObservations(row.observed_part_studios);
    const previous = observed[elementId];
    observed[elementId] = observation;
    db.update(onshapeWebhooks)
      .set({ observed_part_studios: JSON.stringify(observed) })
      .where(eq(onshapeWebhooks.document_id, documentId))
      .run();

    checkCallback(settings, row);
    const deliveredSince =
      previous && row.last_event_at && row.last_event_at >= previous.observedAt;
    if (previous && previous.fingerprint !== fingerprint && !deliveredSince)
      requestRepair(settings, "missed-delivery", documentId);
  } catch (error) {
    console.error("[ONSHAPE WEBHOOK] observation failed:", error);
  }
}

/**
 * Start a repair pass unless one is running, one started in the last 24
 * hours, or the daily ceiling is reached (the pass could not list anyway).
 * The start is recorded before any call, so a pass that fails still counts.
 */
function requestRepair(
  settings: OnshapeWebhookSettings,
  reason: WebhookRepairReason,
  documentId: string
): void {
  if (work.has("repair") || onshapeBudgetStatus().reached) return;
  const [last] = db
    .select({ last_repair_at: onshapeWebhookUpkeepState.last_repair_at })
    .from(onshapeWebhookUpkeepState)
    .where(eq(onshapeWebhookUpkeepState.id, UPKEEP_ROW))
    .limit(1)
    .all();
  const now = new Date();
  if (
    last &&
    now.getTime() - Date.parse(last.last_repair_at) < WEBHOOK_REPAIR_INTERVAL_MS
  )
    return;
  const stamp = {
    last_repair_at: now.toISOString(),
    last_repair_reason: reason,
    last_repair_document_id: documentId,
  };
  db.insert(onshapeWebhookUpkeepState)
    .values({ id: UPKEEP_ROW, ...stamp })
    .onConflictDoUpdate({ target: onshapeWebhookUpkeepState.id, set: stamp })
    .run();
  console.info(`[ONSHAPE WEBHOOK] repair pass: ${reason} (${documentId})`);
  void track("repair", () => repair(settings));
}

/**
 * A callback URL reduced to what decides where a delivery goes and whether it
 * is accepted: origin, path without a trailing slash, and the secret. Onshape
 * may store the URL in a different but equivalent form.
 */
function callbackTarget(url: string) {
  try {
    const parsed = new URL(url);
    return {
      endpoint: parsed.origin + parsed.pathname.replace(/\/+$/, ""),
      secret: parsed.searchParams.get(ONSHAPE_WEBHOOK_SECRET_PARAM),
    };
  } catch {
    return null;
  }
}

/**
 * Does this listed webhook deliver to this app (`withSecret: false`, whatever
 * its secret) or to this app's current callback (`withSecret: true`)?
 */
function deliversTo(
  callback: string,
  url: string,
  { withSecret }: { withSecret: boolean }
): boolean {
  const ours = callbackTarget(callback);
  const listed = callbackTarget(url);
  if (!ours || !listed || listed.endpoint !== ours.endpoint) return false;
  return !withSecret || listed.secret === ours.secret;
}

/**
 * List the key's webhooks and repair the table against what Onshape has:
 * register again any tracked webhook that is missing or delivers to an old
 * callback URL, and delete strays that point here but aren't tracked.
 */
async function repair(settings: OnshapeWebhookSettings): Promise<void> {
  const rows = db.select().from(onshapeWebhooks).all();
  if (rows.length === 0) return;
  const callback = onshapeWebhookCallbackUrl(settings);
  const listed = await listWebhooks();
  const byId = new Map(listed.map((hook) => [hook.id, hook]));
  const tracked = new Set(rows.map((row) => row.webhook_id));

  for (const hook of listed)
    if (
      !tracked.has(hook.id) &&
      hook.url &&
      deliversTo(callback, hook.url, { withSecret: false })
    )
      await deleteWebhook(hook.id);

  for (const row of rows) {
    const hook = byId.get(row.webhook_id);
    if (
      hook &&
      (hook.url === undefined ||
        deliversTo(callback, hook.url, { withSecret: true }))
    )
      continue;
    if (hook) await deleteWebhook(hook.id);
    save(settings, row.document_id, await register(settings, row.document_id));
  }

  db.update(onshapeWebhooks)
    .set({
      last_checked_at: new Date().toISOString(),
      callback_hash: callbackHash(settings),
    })
    .where(
      inArray(
        onshapeWebhooks.document_id,
        rows.map((row) => row.document_id)
      )
    )
    .run();
}

/** The upkeep interface; see the module comment. */
export const onshapeWebhookUpkeep = { ensure, deliverySeen, workspaceObserved };

export type OnshapeWebhookStatus =
  | { enabled: false }
  | {
      enabled: true;
      registered: number;
      lastEventAt: string | null;
      lastCheckedAt: string | null;
      lastRepairAt: string | null;
      lastRepairReason: WebhookRepairReason | null;
      lastRepairDocumentId: string | null;
    };

/** What `/onshape` and `/api/onshape/usage` show. */
export function onshapeWebhookStatus(): OnshapeWebhookStatus {
  if (!onshapeWebhookSettings()) return { enabled: false };
  const rows = db.select().from(onshapeWebhooks).all();
  const latest = (values: (string | null)[]) =>
    values.reduce<string | null>(
      (max, value) => (value && (!max || value > max) ? value : max),
      null
    );
  const [upkeep] = db
    .select()
    .from(onshapeWebhookUpkeepState)
    .where(eq(onshapeWebhookUpkeepState.id, UPKEEP_ROW))
    .limit(1)
    .all();
  return {
    enabled: true,
    registered: rows.length,
    lastEventAt: latest(rows.map((row) => row.last_event_at)),
    lastCheckedAt: latest(rows.map((row) => row.last_checked_at)),
    lastRepairAt: upkeep?.last_repair_at ?? null,
    lastRepairReason:
      (upkeep?.last_repair_reason as WebhookRepairReason | undefined) ?? null,
    lastRepairDocumentId: upkeep?.last_repair_document_id ?? null,
  };
}
