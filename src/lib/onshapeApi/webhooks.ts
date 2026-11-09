import "virtual:hawk-shop/server-only";

/**
 * Keeps one Onshape webhook registered per document whose workspace the app
 * reads, so `POST /api/onshape/webhook` hears about edits (see
 * docs/ONSHAPE.md#webhooks).
 *
 * - `ensureOnshapeWebhook` runs after a workspace parts read. It registers a
 *   webhook the first time a document is seen and costs nothing afterwards.
 * - `recheckOnshapeWebhooks` runs on boot and then daily. It lists the key's
 *   webhooks, registers again any that Onshape dropped, and deletes strays that
 *   point at this app but aren't tracked.
 *
 * Every call goes through `onshapeFetch` and is tallied under its own usage
 * label. Webhook management isn't cacheable. When webhooks are disabled, none of
 * this calls Onshape. Nothing here throws to its caller: a failed registration
 * must never fail a parts read.
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "~/server/db/client";
import { onshapeWebhooks } from "~/server/db/schema";
import {
  ONSHAPE_DOCUMENT_CHANGE_EVENTS,
  ONSHAPE_WEBHOOK_SECRET_PARAM,
  onshapeWebhookCallbackUrl,
  onshapeWebhookSettings,
  type OnshapeWebhookSettings,
} from "~/server/onshape-webhook";
import { assertOnshapeAllocation, onshapeApiRequest } from "./auth";
import { recordOnshapeUsage } from "./cache";

export const WEBHOOK_USAGE_LABELS = {
  register: "webhook-register",
  list: "webhook-list",
  delete: "webhook-delete",
} as const;

export const WEBHOOK_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const globalForWebhooks = globalThis as unknown as {
  __onshapeWebhookWork?: Map<string, Promise<void>>;
};
/** Registrations and checks still running, keyed by document (or "check"). */
const work = (globalForWebhooks.__onshapeWebhookWork ??= new Map());

/** Resolves once every registration or check started so far has settled. */
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
  const response = await onshapeApiRequest("/v6/webhooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      events: [...ONSHAPE_DOCUMENT_CHANGE_EVENTS],
      filter: filterFor(documentId),
      options: { collapseEvents: false },
      url: onshapeWebhookCallbackUrl(settings),
      isTransient: false,
    }),
  });
  assertOnshapeAllocation(response);
  if (!response.ok) throw new Error(`registration answered ${response.status}`);
  const body = (await response.json()) as { id?: unknown };
  recordOnshapeUsage(WEBHOOK_USAGE_LABELS.register, "call");
  if (typeof body.id !== "string" || !body.id)
    throw new Error("registration returned no webhook id");
  return body.id;
}

type ListedWebhook = { id: string; url?: string };

async function listWebhooks(): Promise<ListedWebhook[]> {
  const hooks: ListedWebhook[] = [];
  let next: string | null = "/v6/webhooks?limit=100";
  for (let page = 0; next && page < 50; page++) {
    const response = await onshapeApiRequest(next);
    assertOnshapeAllocation(response);
    if (!response.ok) throw new Error(`listing answered ${response.status}`);
    const body = (await response.json()) as {
      items?: { id?: unknown; url?: unknown }[];
      next?: unknown;
    };
    recordOnshapeUsage(WEBHOOK_USAGE_LABELS.list, "call");
    for (const item of body.items ?? [])
      if (typeof item.id === "string")
        hooks.push({
          id: item.id,
          url: typeof item.url === "string" ? item.url : undefined,
        });
    next = typeof body.next === "string" && body.next ? body.next : null;
  }
  return hooks;
}

async function deleteWebhook(webhookId: string): Promise<void> {
  const response = await onshapeApiRequest(
    `/v6/webhooks/${encodeURIComponent(webhookId)}`,
    { method: "DELETE" }
  );
  assertOnshapeAllocation(response);
  // Already gone is as good as deleted.
  if (!response.ok && response.status !== 404)
    throw new Error(`deletion answered ${response.status}`);
  if (response.ok) recordOnshapeUsage(WEBHOOK_USAGE_LABELS.delete, "call");
}

function save(documentId: string, webhookId: string): void {
  const registered_at = new Date().toISOString();
  db.insert(onshapeWebhooks)
    .values({ document_id: documentId, webhook_id: webhookId, registered_at })
    .onConflictDoUpdate({
      target: onshapeWebhooks.document_id,
      set: { webhook_id: webhookId, registered_at },
    })
    .run();
}

/**
 * Make sure `documentId` has a webhook. Called without awaiting after a
 * workspace parts read; a document already in the table costs one SQLite read.
 */
export function ensureOnshapeWebhook(documentId: string): Promise<void> {
  const settings = onshapeWebhookSettings();
  if (!settings || !documentId) return Promise.resolve();
  try {
    const [known] = db
      .select({ document_id: onshapeWebhooks.document_id })
      .from(onshapeWebhooks)
      .where(eq(onshapeWebhooks.document_id, documentId))
      .limit(1)
      .all();
    if (known) return Promise.resolve();
  } catch (error) {
    console.error("[ONSHAPE WEBHOOK] lookup failed:", error);
    return Promise.resolve();
  }
  return track(`register:${documentId}`, async () => {
    save(documentId, await register(settings, documentId));
  });
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
export function recheckOnshapeWebhooks(): Promise<void> {
  const settings = onshapeWebhookSettings();
  if (!settings) return Promise.resolve();
  return track("check", async () => {
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
      save(row.document_id, await register(settings, row.document_id));
    }

    db.update(onshapeWebhooks)
      .set({ last_checked_at: new Date().toISOString() })
      .where(
        inArray(
          onshapeWebhooks.document_id,
          rows.map((row) => row.document_id)
        )
      )
      .run();
  });
}

/** Record that a delivery for this document arrived. Never throws. */
export function recordOnshapeWebhookEvent(documentId: string): void {
  try {
    db.update(onshapeWebhooks)
      .set({ last_event_at: new Date().toISOString() })
      .where(eq(onshapeWebhooks.document_id, documentId))
      .run();
  } catch (error) {
    console.error("[ONSHAPE WEBHOOK] event record failed:", error);
  }
}

export type OnshapeWebhookStatus =
  | { enabled: false }
  | {
      enabled: true;
      registered: number;
      lastEventAt: string | null;
      lastCheckedAt: string | null;
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
  return {
    enabled: true,
    registered: rows.length,
    lastEventAt: latest(rows.map((row) => row.last_event_at)),
    lastCheckedAt: latest(rows.map((row) => row.last_checked_at)),
  };
}

type Schedule = (run: () => void, everyMs: number) => () => void;

const intervalSchedule: Schedule = (run, everyMs) => {
  const timer = setInterval(run, everyMs);
  timer.unref();
  return () => clearInterval(timer);
};

/**
 * Check now, then every day. `schedule` is the timer seam: production uses
 * `setInterval`, tests pass a fake and fire it by hand. Returns a stop function.
 */
export function startOnshapeWebhookChecks(
  schedule: Schedule = intervalSchedule
): () => void {
  const run = () => void recheckOnshapeWebhooks();
  const stop = schedule(run, WEBHOOK_CHECK_INTERVAL_MS);
  run();
  return stop;
}
