import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";
import type { PartsPageSearchParams } from "../page";

/**
 * Build the React Query key for parts data
 */
export function getPartsQueryKey(queryParams: PartsPageSearchParams) {
  return [
    "onshape-parts",
    queryParams.documentId,
    queryParams.instanceType,
    queryParams.instanceId,
    queryParams.elementId,
  ] as const;
}

/**
 * Build URL search params for the parts API route
 */
export function buildPartsApiParams(queryParams: PartsPageSearchParams) {
  return new URLSearchParams({
    documentId: queryParams.documentId,
    instanceType: queryParams.instanceType,
    instanceId: queryParams.instanceId,
    elementId: queryParams.elementId,
    withThumbnails: "true",
  });
}

/**
 * Fetch parts from the API route
 * Used by client-side components
 */
export async function fetchParts(
  queryParams: PartsPageSearchParams
): Promise<BtPartMetadataInfo[]> {
  const params = buildPartsApiParams(queryParams);
  const response = await fetch(`/api/onshape/parts?${params.toString()}`);

  if (!response.ok) {
    // Try to extract error message from response
    let errorMessage = `Failed to fetch parts: ${response.statusText}`;
    try {
      const errorData = await response.json();
      if (errorData.error) {
        errorMessage = errorData.error;
      }
    } catch {
      // If JSON parsing fails, use the default message
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * React Query options for fetching parts (client-side)
 */
export function getPartsQueryOptions(queryParams: PartsPageSearchParams) {
  return {
    queryKey: getPartsQueryKey(queryParams),
    queryFn: () => fetchParts(queryParams),
    enabled: !!queryParams?.documentId,
    staleTime: 30 * 1000, // Cache for 30 seconds
  };
}
