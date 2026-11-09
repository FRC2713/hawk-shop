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
export function remainingLabel(url: string): string {
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
 * Save the header from one response. A missing or malformed header leaves the
 * stored value alone; a 402 is recorded even without the header so the status
 * page can say the allocation is used up. Never throws.
 */
export function recordOnshapeRemaining(url: string, response: Response): void {
  try {
    const value = parseRemaining(response.headers.get(REMAINING_HEADER));
    if (value === null && response.status !== 402) return;
    const label = remainingLabel(url);
    // Delete and re-insert so rowid tracks write order: two families seen in
    // the same millisecond still have a definite latest.
    db.transaction((tx) => {
      const [previous] = tx
        .select({ remaining: onshapeApiRemaining.remaining })
        .from(onshapeApiRemaining)
        .where(eq(onshapeApiRemaining.label, label))
        .all();
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
