import "virtual:hawk-shop/server-only";
import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";
import { cacheKey, partsTtlMs } from "~/lib/onshapeApi/cache";
import { onshapeRead } from "~/lib/onshapeApi/gateway";
import { ensureOnshapeWebhook } from "~/lib/onshapeApi/webhooks";
import type { PartsPageSearchParams } from "./types";

/**
 * Core function to fetch parts from Onshape API
 * This is used by both the API route and server-side prefetching
 * SERVER-ONLY: Uses server-side authentication
 *
 * Reads go through the Onshape gateway (`~/lib/onshapeApi/gateway`). The Part
 * Studio contents are the same for every user who can see the document, so a
 * whole shop opening the connector at once costs one Onshape call rather than
 * one per student — and at `wvm=v` the answer is immutable, so it costs one
 * call ever.
 *
 * @param queryParams - Query parameters for fetching parts
 */
export async function fetchPartsFromOnshape(
  queryParams: PartsPageSearchParams
): Promise<BtPartMetadataInfo[]> {
  const { documentId, instanceType, instanceId, elementId } = queryParams;
  const parts = await onshapeRead<BtPartMetadataInfo[]>({
    label: "parts",
    cache: {
      key: cacheKey("parts", documentId, instanceType, instanceId, elementId),
      ttlMs: partsTtlMs(instanceType),
    },
    request: {
      path: `/v12/parts/d/${encodeURIComponent(documentId)}/${encodeURIComponent(instanceType)}/${encodeURIComponent(instanceId)}/e/${encodeURIComponent(elementId)}`,
      query: { withThumbnails: true, includePropertyDefaults: true },
    },
  });

  // Cards keep the microversion and thumbnail they were released with, so a
  // workspace read leaves them alone.
  if (queryParams.instanceType === "w" && Array.isArray(parts)) {
    // Hear about the next edit to this document instead of waiting out the
    // TTL. Not awaited: registration must never slow or fail a parts read.
    void ensureOnshapeWebhook(queryParams.documentId);
  }

  return parts;
}
