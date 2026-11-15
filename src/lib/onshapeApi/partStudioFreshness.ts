import "virtual:hawk-shop/server-only";

/**
 * Part Studio freshness: the one answer to "may I reuse this Part Studio
 * read?" It owns the parts cache key, the TTL for each scope and every reason
 * a read goes stale, so no caller builds a Part Studio key or picks a TTL.
 *
 * - Versions and microversions (`wvm=v`, `wvm=m`) are immutable: cached
 *   forever, untouched by change events and expiry.
 * - A workspace read (`wvm=w`) expires after `workspaceTtlMs()`: 24 hours with
 *   webhooks configured, five minutes without.
 * - A change event (`changed`) does not delete workspace reads. It marks them
 *   stale with a floor: a marked read stays reusable until it is
 *   `minRefreshMs()` old, measured from when it was fetched. However many
 *   edits arrive, a Part Studio is re-read at most once per window, and only
 *   when someone asks for it.
 * - A part-number write (`wrote`) is applied to the cached read instead of
 *   discarding it, so the connector shows the new number with no extra read.
 *
 * See docs/ONSHAPE.md#webhooks.
 */

import type { BtPartMetadataInfo } from "./generated-wrapper";
import {
  cacheKey,
  detachOnshapeRead,
  invalidateOnshapeCache,
  NEVER_EXPIRES,
  onshapeCacheRows,
  onshapeReadsInFlight,
  patchOnshapeCache,
  setOnshapeCacheExpiry,
} from "./cache";
import { onshapeRead } from "./gateway";
import { onshapeWebhookSettings } from "~/server/onshape-webhook";

/** The four ids that name one Part Studio at one point in its history. */
export type PartStudio = {
  documentId: string;
  /** `w` (workspace), `v` (version) or `m` (microversion). */
  instanceType: string;
  instanceId: string;
  elementId: string;
};

/** What a successful write changed on one part. */
export type PartPatch = { partNumber: string };

const LABEL = "parts";
const DEFAULT_WORKSPACE_TTL_SECONDS = 300;
const WEBHOOK_WORKSPACE_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_MIN_REFRESH_SECONDS = 300;

function keyOf({
  documentId,
  instanceType,
  instanceId,
  elementId,
}: PartStudio): string {
  return cacheKey(LABEL, documentId, instanceType, instanceId, elementId);
}

/** Prefix shared by every workspace read of one document. */
function workspacePrefix(documentId: string): string {
  return cacheKey(LABEL, documentId, "w", "");
}

/** Whether a key under `workspacePrefix(documentId)` is for `elementId`. */
function isElementKey(key: string, documentId: string, elementId?: string) {
  const prefix = workspacePrefix(documentId);
  if (!key.startsWith(prefix)) return false;
  if (elementId === undefined) return true;
  // What remains is `<workspaceId>::<elementId>`.
  return key.slice(prefix.length).endsWith(cacheKey("", elementId));
}

/**
 * TTL for workspace reads. With configured webhooks, change events mark reads
 * stale and 24 hours is the safety net; otherwise five minutes. A finite,
 * positive `ONSHAPE_CACHE_TTL_SECONDS` overrides either default.
 */
export function workspaceTtlMs(): number {
  const raw = Number(process.env.ONSHAPE_CACHE_TTL_SECONDS);
  if (Number.isFinite(raw) && raw > 0) return raw * 1000;
  return (
    (onshapeWebhookSettings()
      ? WEBHOOK_WORKSPACE_TTL_SECONDS
      : DEFAULT_WORKSPACE_TTL_SECONDS) * 1000
  );
}

/** Scope-appropriate TTL: versions and microversions never expire. */
function ttlMs(instanceType: string): number | null {
  return instanceType === "v" || instanceType === "m"
    ? NEVER_EXPIRES
    : workspaceTtlMs();
}

/**
 * The refresh window: how old a stale-marked workspace read must be before it
 * is read again. `ONSHAPE_MIN_REFRESH_SECONDS`, a positive integer, overrides
 * the default of 300.
 */
export function minRefreshMs(): number {
  const raw = process.env.ONSHAPE_MIN_REFRESH_SECONDS?.trim();
  const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return (
    (Number.isSafeInteger(seconds) && seconds > 0
      ? seconds
      : DEFAULT_MIN_REFRESH_SECONDS) * 1000
  );
}

/**
 * The parts of a Part Studio, from the cache when it may be reused. This is
 * the one place a parts read can go upstream: something that should happen
 * only after a real Onshape read (not a cache hit) belongs here, once the
 * gateway's `onshapeRead` reports which it was.
 */
async function get(partStudio: PartStudio): Promise<BtPartMetadataInfo[]> {
  const { documentId, instanceType, instanceId, elementId } = partStudio;
  return onshapeRead<BtPartMetadataInfo[]>({
    label: LABEL,
    cache: { key: keyOf(partStudio), ttlMs: ttlMs(instanceType) },
    request: {
      path: `/v12/parts/d/${encodeURIComponent(documentId)}/${encodeURIComponent(instanceType)}/${encodeURIComponent(instanceId)}/e/${encodeURIComponent(elementId)}`,
      query: { withThumbnails: true, includePropertyDefaults: true },
    },
  });
}

/**
 * A change to a document's workspace, scoped to one element when the event
 * names it. Matching workspace reads expire at
 * `min(current expiry, max(now, fetched + window))`, so repeated events never
 * push expiry later and never force an immediate re-read of a young entry.
 * Reads in flight are detached: they started before the change.
 */
function changed(documentId: string, elementId?: string): void {
  for (const key of onshapeReadsInFlight())
    if (isElementKey(key, documentId, elementId)) detachOnshapeRead(key);

  const now = Date.now();
  const window = minRefreshMs();
  for (const row of onshapeCacheRows(workspacePrefix(documentId))) {
    if (!isElementKey(row.key, documentId, elementId)) continue;
    const floor = Math.max(now, row.fetchedAt.getTime() + window);
    const expiry = Math.min(row.expiresAt?.getTime() ?? Infinity, floor);
    if (expiry !== row.expiresAt?.getTime())
      setOnshapeCacheExpiry(row.key, new Date(expiry));
  }
}

function isPartNumberProperty(property: Record<string, unknown>): boolean {
  const name =
    typeof property.name === "string" ? property.name.toLowerCase() : "";
  const id = typeof property.propertyId === "string" ? property.propertyId : "";
  return (
    name === "part number" ||
    name === "partnumber" ||
    name === "part_number" ||
    id.toLowerCase().includes("partnumber") ||
    id.toLowerCase().includes("part_number")
  );
}

function applyPatch(payload: unknown, partId: string, patch: PartPatch) {
  if (!Array.isArray(payload)) return payload;
  return payload.map((part: Record<string, unknown> | null) => {
    if (!part || part.partId !== partId) return part;
    const properties = Array.isArray(part.properties)
      ? part.properties.map((property: Record<string, unknown> | null) =>
          property && isPartNumberProperty(property)
            ? { ...property, value: patch.partNumber }
            : property
        )
      : part.properties;
    return { ...part, partNumber: patch.partNumber, properties };
  });
}

/**
 * Onshape accepted a write to one part. The cached read (if any) gets the new
 * value and counts as freshly observed; with nothing cached, nothing is
 * fetched. A read in flight is detached, because it may carry the old value.
 */
function wrote(partStudio: PartStudio, partId: string, patch: PartPatch): void {
  const key = keyOf(partStudio);
  detachOnshapeRead(key);
  patchOnshapeCache(
    key,
    (payload) => applyPatch(payload, partId, patch),
    ttlMs(partStudio.instanceType)
  );
}

/**
 * Drop one Part Studio read entirely, so the next read goes upstream. For a
 * write whose outcome could not be confirmed: the cached read can no longer
 * be trusted either way.
 */
function discard(partStudio: PartStudio): void {
  invalidateOnshapeCache(keyOf(partStudio));
}

export const partStudioFreshness = { get, changed, wrote, discard };
