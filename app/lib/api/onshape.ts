import { queryOptions } from "@tanstack/react-query";
import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";
import { apiFetch, searchParams } from "./client";
import { queryKeys } from "./keys";

/** The four ids that identify a Part Studio. */
export interface OnshapePartsScope {
  documentId: string;
  instanceType: string;
  instanceId: string;
  elementId: string;
}

/** Only the field the UI actually reads off `/api/onshape/version`. */
export interface OnshapeVersion {
  name?: string;
}

/**
 * Parts for a Part Studio, proxied through our server so the browser never
 * holds an Onshape token.
 *
 * `withThumbnails` is a real cache dimension, not just a request flag — the
 * connector needs thumbnails and the card sheet does not, and before it was
 * part of the key the two shared an entry and whichever loaded first won.
 */
export function onshapePartsQuery(
  scope: Partial<OnshapePartsScope>,
  { withThumbnails = false }: { withThumbnails?: boolean } = {}
) {
  const complete = isComplete(scope);
  return queryOptions({
    queryKey: queryKeys.onshape.parts(
      {
        documentId: scope.documentId ?? "",
        instanceType: scope.instanceType ?? "",
        instanceId: scope.instanceId ?? "",
        elementId: scope.elementId ?? "",
      },
      withThumbnails
    ),
    queryFn: () => {
      if (!complete) throw new Error("Missing Onshape part studio parameters");
      const query = searchParams({
        documentId: scope.documentId,
        instanceType: scope.instanceType,
        instanceId: scope.instanceId,
        elementId: scope.elementId,
        withThumbnails: withThumbnails ? "true" : undefined,
      });
      return apiFetch<BtPartMetadataInfo[]>(`/api/onshape/parts?${query}`, {
        fallbackError: "Failed to fetch parts",
      });
    },
    enabled: complete,
    staleTime: 30 * 1000,
  });
}

export function onshapeVersionQuery(
  documentId: string | null | undefined,
  versionId: string | null | undefined
) {
  return queryOptions({
    queryKey: queryKeys.onshape.version(documentId ?? "", versionId ?? ""),
    queryFn: () => {
      if (!documentId || !versionId) {
        throw new Error("Missing document ID or version ID");
      }
      const query = searchParams({ documentId, versionId });
      return apiFetch<OnshapeVersion>(`/api/onshape/version?${query}`, {
        fallbackError: "Failed to fetch version",
      });
    },
    enabled: !!documentId && !!versionId,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

function isComplete(
  scope: Partial<OnshapePartsScope>
): scope is OnshapePartsScope {
  return !!(
    scope.documentId &&
    scope.instanceType &&
    scope.instanceId &&
    scope.elementId
  );
}
