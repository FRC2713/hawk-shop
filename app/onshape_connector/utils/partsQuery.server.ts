import "server-only";
import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";
import {
  createOnshapeApiClient,
  createOnshapeApiClientReadOnly,
  getPartsWmve,
} from "~/lib/onshapeApi/generated-wrapper";
import type { PartsPageSearchParams } from "../page";

/**
 * Core function to fetch parts from Onshape API
 * This is used by both the API route and server-side prefetching
 * SERVER-ONLY: Uses server-side authentication
 *
 * @param queryParams - Query parameters for fetching parts
 * @param allowTokenRefresh - If true, will attempt to refresh tokens (for Route Handlers).
 *                           If false, uses read-only token access (for server components).
 */
export async function fetchPartsFromOnshape(
  queryParams: PartsPageSearchParams,
  allowTokenRefresh: boolean = true
): Promise<BtPartMetadataInfo[]> {
  // Use read-only client for server components, full client for route handlers
  const client = allowTokenRefresh
    ? await createOnshapeApiClient()
    : await createOnshapeApiClientReadOnly();

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
