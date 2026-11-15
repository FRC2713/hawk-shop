import "virtual:hawk-shop/server-only";

/**
 * Cache keys, TTLs, invalidation and the usage tally behind the Onshape
 * gateway (`./gateway`). Every read and write of `onshape_api_cache` rows is
 * here. Two modules use them: the gateway, which owns the read policy and
 * single-flight and reads and writes rows (`readOnshapeCache`,
 * `writeOnshapeCache`), and Part Studio freshness (`./partStudioFreshness`),
 * which marks rows stale and patches them after a write. Nothing else touches
 * the cache rows.
 *
 * Onshape's allowance is yearly, so staleness is cheap and a cache miss is not
 * (see docs/ONSHAPE.md#allocation-and-billing). Anything with an immutable
 * upstream (a version, a microversion) is cached with no expiry at all.
 *
 * Single-process by design, like `~/server/events/bus` — a second replica would
 * duplicate at most one call per key per TTL, so this degrades gracefully
 * rather than breaking.
 */

import { desc, eq, like, sql } from "drizzle-orm";
import { db } from "~/server/db/client";
import { onshapeApiCache, onshapeApiUsage } from "~/server/db/schema";

/** Pass as `ttlMs` for a response whose upstream can never change. */
export const NEVER_EXPIRES = null;

/**
 * TTL for version metadata.
 *
 * A version's contents are frozen, but its *name* can be edited, so this is not
 * quite `NEVER_EXPIRES`. A week still removes essentially all of the traffic —
 * the alternative was one call per card-detail open, forever.
 */
export const VERSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * In-flight upstream requests, keyed the same way as the table. The gateway's
 * single-flight lives here so invalidation can detach reads that started
 * before an edit.
 *
 * Parked on `globalThis` for the same reason the db handle is: dev-mode module
 * reloads would otherwise strand the map and lose the dedup.
 */
const globalForCache = globalThis as unknown as {
  __onshapeInflight?: Map<string, Promise<unknown>>;
};
export const onshapeInflight: Map<
  string,
  Promise<unknown>
> = (globalForCache.__onshapeInflight ??= new Map());
const inflight = onshapeInflight;

const KEY_SEPARATOR = "::";

/** Build a stable cache key. Parts are ordered, so callers cannot transpose them. */
export function cacheKey(label: string, ...parts: (string | number)[]): string {
  return [label, ...parts].join(KEY_SEPARATOR);
}

/** Drop the durable entry and detach reads that started before the edit. */
export function invalidateOnshapeCache(key: string): void {
  inflight.delete(key);
  db.delete(onshapeApiCache).where(eq(onshapeApiCache.cache_key, key)).run();
}

/**
 * Detach a read in flight so its answer is returned to whoever awaits it but
 * never stored: it started before an edit and would store a pre-edit payload
 * as freshly fetched.
 */
export function detachOnshapeRead(key: string): void {
  inflight.delete(key);
}

/** Keys of reads currently in flight. */
export function onshapeReadsInFlight(): string[] {
  return [...inflight.keys()];
}

/**
 * One durable row's payload, and whether it has expired. The gateway decides
 * what to do with it. A corrupt row or unreadable volume reads as a miss.
 */
export function readOnshapeCache(
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

/**
 * Store a freshly fetched payload: fetch time now, expiry `ttlMs` from now
 * (`null` never expires). A failed write is logged, never thrown.
 */
export function writeOnshapeCache(
  key: string,
  value: unknown,
  ttlMs: number | null
): void {
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

/** A durable cache row without its payload. */
export type OnshapeCacheRow = {
  key: string;
  /** When the payload was fetched (or last observed to be current). */
  fetchedAt: Date;
  /** `null` never expires. */
  expiresAt: Date | null;
};

/** Every durable row whose key starts with `prefix`. */
export function onshapeCacheRows(prefix: string): OnshapeCacheRow[] {
  const pattern = prefix.replace(/[\\%_]/g, (char) => `\\${char}`) + "%";
  return db
    .select({
      key: onshapeApiCache.cache_key,
      created_at: onshapeApiCache.created_at,
      expires_at: onshapeApiCache.expires_at,
    })
    .from(onshapeApiCache)
    .where(sql`${like(onshapeApiCache.cache_key, pattern)} ESCAPE '\\'`)
    .all()
    .map((row) => ({
      key: row.key,
      fetchedAt: new Date(row.created_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    }));
}

/** Move one row's expiry, leaving its payload and fetch time alone. */
export function setOnshapeCacheExpiry(key: string, expiresAt: Date): void {
  db.update(onshapeApiCache)
    .set({ expires_at: expiresAt.toISOString() })
    .where(eq(onshapeApiCache.cache_key, key))
    .run();
}

/**
 * Rewrite a stored payload in place and treat it as freshly observed: fetch
 * time is now. Expiry never moves later than it already is: it becomes
 * `min(current expiry, now + ttlMs)` (`null` never expires), so a row a change
 * event marked stale stays stale. Returns false, changing nothing, when no row
 * exists; nothing is fetched.
 */
export function patchOnshapeCache(
  key: string,
  patch: (payload: unknown) => unknown,
  ttlMs: number | null
): boolean {
  const [row] = db
    .select({
      payload: onshapeApiCache.payload,
      expires_at: onshapeApiCache.expires_at,
    })
    .from(onshapeApiCache)
    .where(eq(onshapeApiCache.cache_key, key))
    .limit(1)
    .all();
  if (!row) return false;
  const now = Date.now();
  const expiry = Math.min(
    row.expires_at ? Date.parse(row.expires_at) : Infinity,
    ttlMs === null ? Infinity : now + ttlMs
  );
  db.update(onshapeApiCache)
    .set({
      payload: JSON.stringify(patch(JSON.parse(row.payload))),
      created_at: new Date(now).toISOString(),
      expires_at: Number.isFinite(expiry)
        ? new Date(expiry).toISOString()
        : null,
    })
    .where(eq(onshapeApiCache.cache_key, key))
    .run();
  return true;
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

/** Calls tallied today (UTC) across all labels: what the daily ceiling counts. */
export function onshapeCallsToday(): number {
  const day = new Date().toISOString().slice(0, 10);
  const [row] = db
    .select({ calls: sql<number>`coalesce(sum(${onshapeApiUsage.calls}), 0)` })
    .from(onshapeApiUsage)
    .where(eq(onshapeApiUsage.day, day))
    .all();
  return Number(row?.calls ?? 0);
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
