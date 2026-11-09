import "virtual:hawk-shop/server-only";

/**
 * Server-side cache for Onshape API responses, plus the usage tally that tells
 * you whether it is working.
 *
 * Onshape's allowance is yearly, so staleness is cheap and a cache miss is not
 * (see docs/ONSHAPE.md#allocation-and-billing). Anything with an immutable
 * upstream (a version, a microversion) is cached with no expiry at all.
 *
 * Two layers sit here:
 *
 * - **SQLite** (`onshape_api_cache`) so the cache survives `docker compose up`.
 *   An in-memory cache would re-buy the whole board after every restart.
 * - **In-process single-flight** so the ten browsers that hit the board when
 *   the shop opens produce one upstream call rather than ten. The SQLite layer
 *   alone cannot do this: none of the ten have written a row yet.
 *
 * Single-process by design, like `~/server/events/bus` — a second replica would
 * duplicate at most one call per key per TTL, so this degrades gracefully
 * rather than breaking.
 */

import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "~/server/db/client";
import { onshapeApiCache, onshapeApiUsage } from "~/server/db/schema";

/** Pass as `ttlMs` for a response whose upstream can never change. */
export const NEVER_EXPIRES = null;

const DEFAULT_WORKSPACE_TTL_SECONDS = 300;

/**
 * TTL for reads against a **workspace** (`wvm=w`), the one Part Studio scope
 * that changes under you as students edit CAD.
 *
 * Five minutes is the default because the connector is used in bursts — a
 * student opens it, releases a few parts, closes it — and within one such burst
 * the part list is not moving. Raise it (`ONSHAPE_CACHE_TTL_SECONDS`) when the
 * allocation is tight; lower it if the team is iterating on CAD and releasing
 * in the same sitting.
 */
export function workspaceTtlMs(): number {
  const raw = Number(process.env.ONSHAPE_CACHE_TTL_SECONDS);
  const seconds =
    Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_WORKSPACE_TTL_SECONDS;
  return seconds * 1000;
}

/**
 * TTL for version metadata.
 *
 * A version's contents are frozen, but its *name* can be edited, so this is not
 * quite `NEVER_EXPIRES`. A week still removes essentially all of the traffic —
 * the alternative was one call per card-detail open, forever.
 */
export const VERSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Parts at a version or microversion are immutable; at a workspace they are
 * not. Callers pass the scope through and get the right expiry without having
 * to remember which is which.
 */
export function partsTtlMs(instanceType: string): number | null {
  return instanceType === "v" || instanceType === "m"
    ? NEVER_EXPIRES
    : workspaceTtlMs();
}

/**
 * In-flight upstream requests, keyed the same way as the table.
 *
 * Parked on `globalThis` for the same reason the db handle is: dev-mode module
 * reloads would otherwise strand the map and lose the dedup.
 */
const globalForCache = globalThis as unknown as {
  __onshapeInflight?: Map<string, Promise<unknown>>;
};
const inflight = (globalForCache.__onshapeInflight ??= new Map());

/** Build a stable cache key. Parts are ordered, so callers cannot transpose them. */
export function cacheKey(label: string, ...parts: (string | number)[]): string {
  return [label, ...parts].join("::");
}

/** What identifies one part's state in Onshape: it changes only when the part does. */
export interface OnshapePartMicroversion {
  documentId: string;
  elementId: string;
  partId: string;
  microversionId: string;
}

/**
 * Key for data derived from one part at one microversion, such as its
 * thumbnail. A part's microversion changes only when the part does, so data
 * under this key never goes stale and needs no TTL, and an edit moves the
 * part to a new key instead of serving the old answer.
 */
export function partCacheKey(
  label: string,
  part: OnshapePartMicroversion
): string {
  return cacheKey(
    label,
    part.documentId,
    part.elementId,
    part.partId,
    part.microversionId
  );
}

/** Drop the durable entry and detach reads that started before the edit. */
export function invalidateOnshapeCache(key: string): void {
  inflight.delete(key);
  db.delete(onshapeApiCache).where(eq(onshapeApiCache.cache_key, key)).run();
}

function readCache<T>(key: string): { hit: true; value: T } | { hit: false } {
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
    if (row.expires_at && new Date(row.expires_at) <= new Date()) {
      return { hit: false };
    }
    return { hit: true, value: JSON.parse(row.payload) as T };
  } catch (error) {
    // A corrupt row or unreadable volume must degrade to "just call Onshape",
    // never to a failed page.
    console.error("[ONSHAPE CACHE] read failed:", error);
    return { hit: false };
  }
}

function writeCache(key: string, value: unknown, ttlMs: number | null): void {
  try {
    const expiresAt =
      ttlMs === null ? null : new Date(Date.now() + ttlMs).toISOString();
    db.insert(onshapeApiCache)
      .values({
        cache_key: key,
        payload: JSON.stringify(value),
        created_at: new Date().toISOString(),
        expires_at: expiresAt,
      })
      .onConflictDoUpdate({
        target: onshapeApiCache.cache_key,
        set: {
          payload: JSON.stringify(value),
          created_at: new Date().toISOString(),
          expires_at: expiresAt,
        },
      })
      .run();
  } catch (error) {
    console.error("[ONSHAPE CACHE] write failed:", error);
  }
}

/**
 * Record one unit of Onshape usage.
 *
 * `kind: "call"` means a request left the building and will show up on
 * Onshape's annual counter; `kind: "hit"` means this cache paid for it instead.
 * Failures are deliberately *not* recorded as calls: Onshape doesn't charge
 * 4xx/5xx (see docs/ONSHAPE.md#allocation-and-billing).
 */
export function recordOnshapeUsage(label: string, kind: "call" | "hit"): void {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const column = kind === "call" ? "calls" : "hits";
    db.insert(onshapeApiUsage)
      .values({
        day,
        label,
        calls: kind === "call" ? 1 : 0,
        hits: kind === "hit" ? 1 : 0,
      })
      .onConflictDoUpdate({
        target: [onshapeApiUsage.day, onshapeApiUsage.label],
        set: {
          [column]: sql`${sql.identifier(column)} + 1`,
        },
      })
      .run();
  } catch (error) {
    console.error("[ONSHAPE USAGE] tally failed:", error);
  }
}

/** The per-day tally, newest first, with totals and the cache hit rate. */
export function summarizeOnshapeUsage() {
  const byDay = db
    .select()
    .from(onshapeApiUsage)
    .orderBy(desc(onshapeApiUsage.day))
    .all();
  const totals = byDay.reduce(
    (acc, row) => {
      acc.calls += row.calls;
      acc.hits += row.hits;
      return acc;
    },
    { calls: 0, hits: 0 }
  );
  const attempted = totals.calls + totals.hits;
  return {
    totals: {
      ...totals,
      attempted,
      // Share of would-be Onshape calls this cache absorbed.
      hitRate:
        attempted === 0 ? 0 : Math.round((totals.hits / attempted) * 1000) / 10,
    },
    byDay,
  };
}

/**
 * Serve `label`/`key` from cache, or call `fetcher` at most once across all
 * concurrent callers and cache what it returns.
 *
 * A throwing `fetcher` is never cached and never counted: an expired token or a
 * 5xx would otherwise poison the entry for the whole TTL.
 */
export async function withOnshapeCache<T>({
  label,
  key,
  ttlMs,
  fetcher,
}: {
  label: string;
  key: string;
  ttlMs: number | null;
  fetcher: () => Promise<T>;
}): Promise<T> {
  const cached = readCache<T>(key);
  if (cached.hit) {
    recordOnshapeUsage(label, "hit");
    return cached.value;
  }

  const pending = inflight.get(key);
  if (pending) {
    // Someone else is already paying for this exact request — ride along.
    recordOnshapeUsage(label, "hit");
    return pending as Promise<T>;
  }

  let request!: Promise<T>;
  request = (async () => {
    const value = await fetcher();
    recordOnshapeUsage(label, "call");
    if (inflight.get(key) === request) writeCache(key, value, ttlMs);
    return value;
  })();

  inflight.set(key, request);
  try {
    return await request;
  } finally {
    if (inflight.get(key) === request) inflight.delete(key);
  }
}

/**
 * Forget every **workspace** (`wvm=w`) read of one document, durable rows and
 * in-flight requests alike, so the next read goes upstream once.
 *
 * Relies on the key layout `cacheKey(label, documentId, wvm, ...)`. Version and
 * microversion entries are immutable and stay, as do keys of any other shape.
 * Called when an Onshape webhook reports that the document changed.
 */
export function invalidateOnshapeCacheForDocument(documentId: string): void {
  const isWorkspaceRead = (key: string) => {
    const [, keyDocumentId, wvm] = key.split("::");
    return keyDocumentId === documentId && wvm === "w";
  };
  for (const key of [...inflight.keys()])
    if (isWorkspaceRead(key)) inflight.delete(key);
  const keys = db
    .select({ cache_key: onshapeApiCache.cache_key })
    .from(onshapeApiCache)
    .all()
    .map((row) => row.cache_key)
    .filter(isWorkspaceRead);
  if (keys.length > 0)
    db.delete(onshapeApiCache)
      .where(inArray(onshapeApiCache.cache_key, keys))
      .run();
}
