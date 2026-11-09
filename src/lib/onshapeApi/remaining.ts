import "virtual:hawk-shop/server-only";

/**
 * Onshape's own count of calls remaining, read from the `x-rate-limit-remaining`
 * header on every response `onshapeFetch` sees.
 *
 * What the number measures for API-key access is not confirmed: a key once
 * reported 3000 on `users/sessioninfo`, which looks like a per-endpoint bucket
 * rather than the annual allocation. So the value is stored per endpoint family
 * and the UI says "Onshape reports N calls remaining", nothing stronger.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "~/server/db/client";
import { onshapeApiRemaining } from "~/server/db/schema";

export const REMAINING_HEADER = "x-rate-limit-remaining";
const DEFAULT_WARN_AT = 1000;

export type OnshapeRemaining = {
  label: string;
  value: number | null;
  observedAt: string;
  lastStatus: number;
};

/**
 * Stable endpoint family for a request: `/api/v12/parts/d/…` → `parts`,
 * `/api/thumbnails/…` → `thumbnails`. Query strings and ids never appear.
 */
export function endpointFamily(url: string): string {
  const segments = new URL(url).pathname.split("/").filter(Boolean);
  if (segments[0] === "api") segments.shift();
  if (/^v\d+$/.test(segments[0] ?? "")) segments.shift();
  const family = segments[0]?.toLowerCase() ?? "";
  return /^[a-z][a-z0-9-]*$/.test(family) ? family : "other";
}

function parseRemaining(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Save the header from one final (non-3xx) response. A missing or malformed
 * header leaves the stored value alone. A 402 is recorded even without the
 * header so the status page can say the allocation is used up, and the next
 * response after a 402 updates the status the same way so that state clears.
 * Never throws.
 */
export function recordOnshapeRemaining(url: string, response: Response): void {
  try {
    const value = parseRemaining(response.headers.get(REMAINING_HEADER));
    const label = endpointFamily(url);
    db.transaction((tx) => {
      const [previous] = tx
        .select({
          remaining: onshapeApiRemaining.remaining,
          last_status: onshapeApiRemaining.last_status,
        })
        .from(onshapeApiRemaining)
        .where(eq(onshapeApiRemaining.label, label))
        .all();
      if (
        value === null &&
        response.status !== 402 &&
        previous?.last_status !== 402
      )
        return;
      // Delete and re-insert so rowid tracks write order: two families seen in
      // the same millisecond still have a definite latest.
      tx.delete(onshapeApiRemaining)
        .where(eq(onshapeApiRemaining.label, label))
        .run();
      tx.insert(onshapeApiRemaining)
        .values({
          label,
          remaining: value ?? previous?.remaining ?? null,
          observed_at: new Date().toISOString(),
          last_status: response.status,
        })
        .run();
    });
  } catch (error) {
    console.error("[ONSHAPE REMAINING] record failed:", error);
  }
}

/** Every endpoint family seen, most recently observed first. */
export function readOnshapeRemaining(): OnshapeRemaining[] {
  try {
    return db
      .select()
      .from(onshapeApiRemaining)
      .orderBy(sql`rowid desc`)
      .all()
      .map((row) => ({
        label: row.label,
        value: row.remaining,
        observedAt: row.observed_at,
        lastStatus: row.last_status,
      }));
  } catch (error) {
    console.error("[ONSHAPE REMAINING] read failed:", error);
    return [];
  }
}

/** `ONSHAPE_REMAINING_WARN_AT`, default 1000. */
export function remainingWarnAt(): number {
  const raw = process.env.ONSHAPE_REMAINING_WARN_AT?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isSafeInteger(value) && value >= 0 ? value : DEFAULT_WARN_AT;
}

/**
 * What `/onshape` shows: the latest count, the threshold, which families
 * answered 402, and which are below the threshold without being used up.
 */
export function onshapeRemainingStatus(rows = readOnshapeRemaining()) {
  const warnAt = remainingWarnAt();
  return {
    rows,
    latest: rows[0] ?? null,
    warnAt,
    exhausted: rows.filter((row) => row.lastStatus === 402),
    low: rows.filter(
      (row) =>
        row.value !== null && row.value < warnAt && row.lastStatus !== 402
    ),
  };
}

export const formatCount = (value: number) => value.toLocaleString("en-US");

export const formatObservedAt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }) + " UTC";
