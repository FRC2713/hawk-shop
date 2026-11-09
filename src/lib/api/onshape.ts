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

/**
 * `<img>` src for a part thumbnail the connector has from a parts read.
 *
 * With the part's document, element and microversion the server caches the
 * image under that microversion, so an unchanged part never costs a second
 * Onshape call and an edited one gets a fresh picture.
 */
export function onshapeThumbnailSrc(
  href: string,
  part?: {
    documentId?: string;
    elementId?: string;
    partId?: string;
    microversionId?: string;
  }
): string {
  return `/api/onshape/thumbnail?${searchParams({
    url: href,
    documentId: part?.documentId,
    elementId: part?.elementId,
    partId: part?.partId,
    microversionId: part?.microversionId,
  })}`;
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
    // A cut version does not change, and the server caches it for a week
    // anyway — refetching every 5 minutes only ever confirmed the same answer.
    staleTime: 24 * 60 * 60 * 1000,
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
