import "virtual:hawk-shop/server-only";

/**
 * The Onshape gateway: the one path server code takes to reach Onshape.
 *
 * A caller describes a read or a write. The gateway decides caching,
 * single-flight, the usage tally, the 402 mapping and the daily budget guard,
 * so a new Onshape feature cannot forget any of them. Onshape's allocation is
 * yearly (see docs/ONSHAPE.md#allocation-and-billing): a miss is permanent
 * spend, staleness is cheap.
 *
 * - **Durable cache** (`onshape_api_cache`) survives `docker compose up`.
 *   Expired rows stay readable so the budget guard can serve them stale.
 * - **Single-flight** in process: concurrent identical reads share one call.
 * - **Tally**: a successful upstream response is a `call`, an answer from the
 *   cache or a shared in-flight request is a `hit`. Failed responses (4xx/5xx)
 *   are neither cached nor counted, because Onshape does not charge them.
 *
 * The adapter is the seam: the real one is the signed HTTP transport
 * (`onshapeFetch`), tests substitute an in-memory one with `useOnshapeAdapter`.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/client";
import { onshapeApiCache } from "~/server/db/schema";
import {
  assertOnshapeAllocation,
  isOnshapeConfigured,
  OnshapeConfigurationError,
  OnshapeDailyBudgetError,
  onshapeFetch,
  onshapeOrigin,
} from "./auth";
import {
  onshapeCallsToday,
  onshapeInflight as inflight,
  recordOnshapeUsage,
} from "./cache";

export { OnshapeDailyBudgetError } from "./auth";

/** Fixed usage labels, one per feature, as they appear in `/api/onshape/usage`. */
export type OnshapeUsageLabel =
  | "parts"
  | "version"
  | "thumbnail"
  | "metadata-read"
  | "metadata-write"
  | "webhook-register"
  | "webhook-list"
  | "webhook-delete";

/** One Onshape request. `path` is under `/api` (for example `/v12/parts/...`),
 * or an absolute Onshape URL such as a thumbnail href. */
export type OnshapeRequest = {
  method?: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON-serialized as the request body. */
  body?: unknown;
  headers?: Record<string, string>;
};

/** Sends one prepared request to Onshape and returns its final response. */
export type OnshapeAdapter = (request: Request) => Promise<Response>;

/** What a binary read (`responseType: "binary"`) resolves to. */
export type OnshapeBinary = { bytes: Uint8Array; contentType: string | null };

/** A non-OK Onshape response other than 402. Never cached, never counted. */
export class OnshapeRequestError extends Error {
  constructor(
    readonly status: number,
    detail: string
  ) {
    super(`Onshape API error ${status}${detail ? `: ${detail}` : ""}`);
  }
}

const signedTransport: OnshapeAdapter = (request) => onshapeFetch(request);

const globalForGateway = globalThis as unknown as {
  __onshapeAdapter?: OnshapeAdapter;
};

/** Substitute the adapter (tests). Returns a function that restores the previous one. */
export function useOnshapeAdapter(adapter: OnshapeAdapter): () => void {
  const previous = globalForGateway.__onshapeAdapter;
  globalForGateway.__onshapeAdapter = adapter;
  return () => {
    globalForGateway.__onshapeAdapter = previous;
  };
}

function adapter(): OnshapeAdapter {
  return globalForGateway.__onshapeAdapter ?? signedTransport;
}

/**
 * Today's spending ceiling from `ONSHAPE_DAILY_CALL_LIMIT`. Unset, empty,
 * non-positive or non-integer means no limit, so existing installs behave as
 * before until an operator opts in.
 */
export function onshapeDailyCallLimit(): number | null {
  const raw = process.env.ONSHAPE_DAILY_CALL_LIMIT?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const limit = Number(raw);
  return Number.isSafeInteger(limit) && limit > 0 ? limit : null;
}

/** The configured limit, today's (UTC) tallied calls, and whether the guard is active. */
export function onshapeBudgetStatus(): {
  limit: number | null;
  today: number;
  reached: boolean;
} {
  const limit = onshapeDailyCallLimit();
  const today = onshapeCallsToday();
  return { limit, today, reached: limit !== null && today >= limit };
}

/** Operations already admitted past the guard (see `onshapeOperation`). */
const admitted = new AsyncLocalStorage<true>();

function budgetReached(): boolean {
  return !admitted.getStore() && onshapeBudgetStatus().reached;
}

/**
 * Run a multi-step operation (a part-number write with its discovery and
 * verification reads) under one budget check. The guard is checked once, at
 * the start; steps inside are not interrupted when the ceiling is crossed
 * part-way, so a half-finished write never leaves Onshape and a card disagreeing.
 */
export async function onshapeOperation<T>(run: () => Promise<T>): Promise<T> {
  if (budgetReached()) throw new OnshapeDailyBudgetError();
  return admitted.run(true, run);
}

function buildRequest(description: OnshapeRequest): Request {
  const url = new URL(
    description.path.startsWith("https://")
      ? description.path
      : `${onshapeOrigin()}/api${description.path}`
  );
  for (const [name, value] of Object.entries(description.query ?? {}))
    if (value !== undefined) url.searchParams.set(name, String(value));
  const headers = new Headers(description.headers);
  const hasBody = description.body !== undefined;
  if (hasBody && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  return new Request(url, {
    method: description.method ?? "GET",
    headers,
    body: hasBody ? JSON.stringify(description.body) : undefined,
  });
}

async function failureDetail(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    try {
      const body = JSON.parse(text) as { message?: unknown };
      if (typeof body.message === "string") return body.message;
    } catch {
      // Not JSON; fall through to the raw text.
    }
    return text.slice(0, 200);
  } catch {
    return "";
  }
}

async function send(
  description: OnshapeRequest,
  responseType: "json" | "binary"
): Promise<unknown> {
  if (!isOnshapeConfigured()) throw new OnshapeConfigurationError();
  const response = await adapter()(buildRequest(description));
  if (!response.ok) {
    assertOnshapeAllocation(response);
    throw new OnshapeRequestError(
      response.status,
      await failureDetail(response)
    );
  }
  if (responseType === "binary")
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type"),
    } satisfies OnshapeBinary;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function readCache(
  key: string
): { hit: true; value: unknown; expired: boolean } | { hit: false } {
  try {
    const [row] = db
      .select({
        payload: onshapeApiCache.payload,
        expires_at: onshapeApiCache.expires_at,
      })
      .from(onshapeApiCache)
      .where(eq(onshapeApiCache.cache_key, key))
      .limit(1)
      .all();
    if (!row) return { hit: false };
    return {
      hit: true,
      value: JSON.parse(row.payload),
      expired: Boolean(
        row.expires_at && new Date(row.expires_at) <= new Date()
      ),
    };
  } catch (error) {
    // A corrupt row or unreadable volume must degrade to "just call Onshape",
    // never to a failed page.
    console.error("[ONSHAPE CACHE] read failed:", error);
    return { hit: false };
  }
}

function writeCache(key: string, value: unknown, ttlMs: number | null): void {
  try {
    const now = new Date();
    const row = {
      payload: JSON.stringify(value),
      created_at: now.toISOString(),
      expires_at:
        ttlMs === null ? null : new Date(now.getTime() + ttlMs).toISOString(),
    };
    db.insert(onshapeApiCache)
      .values({ cache_key: key, ...row })
      .onConflictDoUpdate({ target: onshapeApiCache.cache_key, set: row })
      .run();
  } catch (error) {
    console.error("[ONSHAPE CACHE] write failed:", error);
  }
}

type ReadOptions = {
  label: OnshapeUsageLabel;
  request: OnshapeRequest;
} & (
  | {
      /** Durable cache entry; `ttlMs: null` never expires. */
      cache: { key: string; ttlMs: number | null };
      dedupKey?: never;
    }
  | {
      cache?: never;
      /** Single-flight key for an uncached read. */
      dedupKey: string;
    }
);

/**
 * Read from Onshape. With `cache`, a stored answer is returned without a call;
 * without it, `dedupKey` still shares one call among concurrent identical reads.
 * Either way the call is tallied under `label` and checked against the daily
 * ceiling: once reached, a cached read returns its stored answer even if
 * expired, and a read with nothing stored throws `OnshapeDailyBudgetError`.
 */
export function onshapeRead<T>(
  options: ReadOptions & { responseType?: "json" }
): Promise<T>;
export function onshapeRead(
  options: ReadOptions & { responseType: "binary" }
): Promise<OnshapeBinary>;
export async function onshapeRead(
  options: ReadOptions & { responseType?: "json" | "binary" }
): Promise<unknown> {
  const { label, cache, request, responseType = "json" } = options;
  const key = cache?.key ?? options.dedupKey!;

  const cached = cache ? readCache(cache.key) : ({ hit: false } as const);
  if (cached.hit && !cached.expired) {
    recordOnshapeUsage(label, "hit");
    return cached.value;
  }

  const pending = inflight.get(key);
  if (pending) {
    // Someone else is already paying for this exact request: ride along.
    recordOnshapeUsage(label, "hit");
    return pending;
  }

  if (budgetReached()) {
    if (cached.hit) {
      recordOnshapeUsage(label, "hit");
      return cached.value;
    }
    throw new OnshapeDailyBudgetError();
  }

  let flight!: Promise<unknown>;
  flight = (async () => {
    const value = await send(request, responseType);
    recordOnshapeUsage(label, "call");
    if (cache && inflight.get(key) === flight)
      writeCache(cache.key, value, cache.ttlMs);
    return value;
  })();
  inflight.set(key, flight);
  try {
    return await flight;
  } finally {
    if (inflight.get(key) === flight) inflight.delete(key);
  }
}

/**
 * Write to Onshape. Never cached or deduplicated; tallied as a call on success
 * and refused with `OnshapeDailyBudgetError` once the daily ceiling is reached
 * (unless inside an `onshapeOperation` that was admitted before it).
 */
export async function onshapeWrite<T>({
  label,
  request,
}: {
  label: OnshapeUsageLabel;
  request: OnshapeRequest;
}): Promise<T> {
  if (budgetReached()) throw new OnshapeDailyBudgetError();
  const value = await send({ method: "POST", ...request }, "json");
  recordOnshapeUsage(label, "call");
  return value as T;
}
