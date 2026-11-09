import "virtual:hawk-shop/server-only";
import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";
import {
  createOnshapeApiClient,
  getPartsWmve,
} from "~/lib/onshapeApi/generated-wrapper";
import { cacheKey, partsTtlMs, withOnshapeCache } from "~/lib/onshapeApi/cache";
import { assertOnshapeAllocation } from "~/lib/onshapeApi/auth";
import { ensureOnshapeWebhook } from "~/lib/onshapeApi/webhooks";
import { syncWorkspaceCardMicroversions } from "~/server/kanbanApi/cards";
import type { PartsPageSearchParams } from "./types";

/**
 * Core function to fetch parts from Onshape API
 * This is used by both the API route and server-side prefetching
 * SERVER-ONLY: Uses server-side authentication
 *
 * Reads go through the shared server cache (`~/lib/onshapeApi/cache`). The Part
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
  const parts = await withOnshapeCache<BtPartMetadataInfo[]>({
    label: "parts",
    key: cacheKey(
      "parts",
      queryParams.documentId,
      queryParams.instanceType,
      queryParams.instanceId,
      queryParams.elementId
    ),
    ttlMs: partsTtlMs(queryParams.instanceType),
    fetcher: () => fetchPartsUncached(queryParams),
  });

  // A workspace changes under its cards. When this read shows a part at a new
  // microversion, its cards follow so their thumbnails refresh. Versions and
  // microversions are frozen, so their cards never need this.
  if (queryParams.instanceType === "w" && Array.isArray(parts)) {
    syncWorkspaceCardMicroversions(
      {
        documentId: queryParams.documentId,
        workspaceId: queryParams.instanceId,
        elementId: queryParams.elementId,
      },
      parts
    );
    // Hear about the next edit to this document instead of waiting out the
    // TTL. Not awaited: registration must never slow or fail a parts read.
    void ensureOnshapeWebhook(queryParams.documentId);
  }

  return parts;
}

async function fetchPartsUncached(
  queryParams: PartsPageSearchParams
): Promise<BtPartMetadataInfo[]> {
  const client = await createOnshapeApiClient();

  const response = await getPartsWmve({
    client,
    path: {
      did: queryParams.documentId,
      wvm: queryParams.instanceType,
      wvmid: queryParams.instanceId,
      eid: queryParams.elementId,
    },
    query: {
      withThumbnails: true,
      includePropertyDefaults: true,
    },
  });

  assertOnshapeAllocation(response.response);

  // Check for errors in the response
  if ((response as any).error) {
    const errorMessage = (response as any).error;

    // Check if it's an authentication error
    if (
      typeof errorMessage === "string" &&
      errorMessage.includes("invalid_token")
    ) {
      throw new Error("Not authenticated with Onshape. Please sign in again.");
    }

    throw new Error(`Onshape API error: ${errorMessage}`);
  }

  // Check if response.data exists
  if (!response.data) {
    throw new Error("Onshape API returned no data");
  }

  return response.data || [];
}
