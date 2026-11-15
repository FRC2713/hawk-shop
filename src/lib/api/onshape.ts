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
 * One part at one microversion. The microversion changes only when the part
 * does, so data derived from it, such as a thumbnail, never goes stale.
 * Client-safe: the server's thumbnail cache uses this type too.
 */
export interface OnshapePartMicroversion {
  documentId: string;
  elementId: string;
  partId: string;
  microversionId: string;
}

/** The identity of a part read from a Part Studio, as far as it is known. */
export function partMicroversionOf(
  scope:
    Partial<Pick<OnshapePartsScope, "documentId" | "elementId">> | undefined,
  part: { partId?: string; microversionId?: string }
): Partial<OnshapePartMicroversion> {
  return {
    documentId: scope?.documentId,
    elementId: scope?.elementId,
    partId: part.partId,
    microversionId: part.microversionId,
  };
}

/** The path of Hawk Shop's thumbnail proxy (`/api/onshape/thumbnail`). */
export const THUMBNAIL_PROXY_PATH = "/api/onshape/thumbnail";

/** What a thumbnail proxy URL points at: an Onshape href, or a card. */
export type ThumbnailProxyTarget =
  | {
      /** The Onshape thumbnail href from a parts read. */
      url: string;
      /**
       * With the part's document, element and microversion the server caches
       * the image under that microversion, so an unchanged part never costs a
       * second Onshape call and an edited one gets a fresh picture.
       */
      part?: Partial<OnshapePartMicroversion>;
    }
  | {
      /** The server resolves the card's image and microversion from its row. */
      cardId: string;
    };

/**
 * Every thumbnail proxy URL, for `<img>` srcs and for the `image_url` the
 * release action stores. Client-safe, so server modules use it too.
 */
export function thumbnailProxyUrl(target: ThumbnailProxyTarget): string {
  const query =
    "cardId" in target
      ? searchParams({ cardId: target.cardId })
      : searchParams({
          url: target.url,
          documentId: target.part?.documentId,
          elementId: target.part?.elementId,
          partId: target.part?.partId,
          microversionId: target.part?.microversionId,
        });
  return `${THUMBNAIL_PROXY_PATH}?${query}`;
}

/**
 * A card's thumbnail URL, or undefined when it has no image to show. Cards are
 * released only from versions, which never change, so the URL needs no
 * cache-buster.
 */
export function cardThumbnailUrl(card: {
  id: string;
  image_url: string | null;
  onshape_document_id: string | null;
}): string | undefined {
  if (!card.image_url && !card.onshape_document_id) return undefined;
  return thumbnailProxyUrl({ cardId: card.id });
}

/** The thumbnail href a part offers, preferring 300x300. */
export function partThumbnailHref(part: {
  thumbnailInfo?: { sizes?: { size?: string; href?: string }[] } | null;
}): string | undefined {
  const sizes = part.thumbnailInfo?.sizes ?? [];
  return (
    sizes.find((size) => size.size === "300x300")?.href ||
    sizes[0]?.href ||
    undefined
  );
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
