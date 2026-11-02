import "@tanstack/react-start/server-only";

/**
 * Server-side cache for Onshape API responses, plus the usage tally that tells
 * you whether it is working.
 *
 * Onshape's quota is an **annual, company-wide** call allowance — not a rate
 * limit you wait out. Every avoided call is permanent savings, which flips the
 * usual caching trade-off: staleness is cheap, a cache miss is not. Anything
 * with an immutable upstream (a version, a microversion) is therefore cached
 * with no expiry at all.
 *
 * Two layers sit here:
 *
 * - **SQLite** (`onshape_api_cache`) so the cache survives `docker compose up`.
 *   An in-memory cache would re-buy the whole board after every restart.
 * - **In-process single-flight** so the ten browsers that hit the board when
 *   the shop opens produce one upstream call rather than ten. The SQLite layer
 *   alone cannot do this: none of the ten have written a row yet.
 *
 * Single-process by design, like `~/lib/events/bus` — a second replica would
 * duplicate at most one call per key per TTL, so this degrades gracefully
 * rather than breaking.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "~/lib/db/client";
import { onshapeApiCache, onshapeApiUsage } from "~/lib/db/schema";

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
 * Failures are deliberately *not* recorded as calls — Onshape excludes 4xx/5xx
 * responses from the allocation, so counting them here would overstate spend.
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
