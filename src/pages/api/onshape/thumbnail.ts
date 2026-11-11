import type { APIRoute } from "astro";
import { requireAuth } from "~/lib/requireAuth";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/client";
import { kanbanCards, partThumbnails } from "~/server/db/schema";
import { recordOnshapeUsage } from "~/lib/onshapeApi/cache";
import type { OnshapePartMicroversion } from "~/lib/api/onshape";
import {
  findStoredThumbnail,
  partFrom,
  partRowKey,
  resolveImageUrl,
  thumbnailStoragePath,
} from "~/server/thumbnails";
import {
  publicUrlForStoragePath,
  saveFile,
  storagePathFromUrl,
} from "~/server/storage/files";
import {
  assertOnshapeAllocation,
  isOnshapeUrl,
  onshapeErrorResponse,
  onshapeFetch,
} from "~/lib/onshapeApi/auth";

/**
 * A same-origin relative redirect. The app sits behind a TLS-terminating
 * gateway, so request.url's scheme is http; a relative Location keeps the
 * browser on its own origin.
 */
function redirectTo(path: string): Response {
  return new Response(null, { status: 307, headers: { Location: path } });
}

/**
 * Thumbnail endpoint for kanban cards and connector part lists.
 *
 * GET ?cardId=<id> — resolves the card's stored `image_url`, keyed by the
 *   card's part and `onshape_microversion_id` when it has one.
 * GET ?url=<onshape url> — used by the connector, which has the part's
 *   thumbnail href from the parts query but no card yet. Adding `documentId`,
 *   `elementId`, `partId` and `microversionId` keys it by microversion.
 *
 * A thumbnail is cached under the part's microversion, which changes only when
 * the part does: an unchanged part never costs a second Onshape call, and an
 * edited one gets a fresh image. Cards and connector rows showing the same part
 * at the same microversion share one stored image.
 */
export const GET: APIRoute = async ({ request }) => {
  // Gated like the other DB-backed routes: a cache hit answers straight
  // from `part_thumbnails` and never reaches Onshape, so needing a token
  // is not by itself a gate here.
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const requestUrl = new URL(request.url);
  const params = requestUrl.searchParams;
  const cardId = params.get("cardId");
  const directUrl = params.get("url");

  if (!cardId && !directUrl) {
    return Response.json({ error: "Missing cardId or url" }, { status: 400 });
  }

  let rawImageUrl: string | null = null;
  let part: OnshapePartMicroversion | null = null;

  if (cardId) {
    const [card] = await db
      .select({
        image_url: kanbanCards.image_url,
        onshape_document_id: kanbanCards.onshape_document_id,
        onshape_element_id: kanbanCards.onshape_element_id,
        onshape_part_id: kanbanCards.onshape_part_id,
        onshape_microversion_id: kanbanCards.onshape_microversion_id,
      })
      .from(kanbanCards)
      .where(eq(kanbanCards.id, cardId))
      .limit(1);

    if (!card) {
      return Response.json({ error: "Card not found" }, { status: 404 });
    }

    rawImageUrl = card.image_url?.trim() || null;
    if (!rawImageUrl) {
      return Response.json({ error: "Card has no image_url" }, { status: 404 });
    }
    part = partFrom({
      documentId: card.onshape_document_id,
      elementId: card.onshape_element_id,
      partId: card.onshape_part_id,
      microversionId: card.onshape_microversion_id,
    });
  } else {
    rawImageUrl = directUrl!.trim() || null;
    if (!rawImageUrl) {
      return Response.json({ error: "Empty url" }, { status: 400 });
    }
    part = partFrom({
      documentId: params.get("documentId"),
      elementId: params.get("elementId"),
      partId: params.get("partId"),
      microversionId: params.get("microversionId"),
    });
    // The ids come from the caller, and Onshape's thumbnail href
    // (`/api/thumbnails/<id>/s/<size>`) names no part, so nothing ties them
    // together. findStoredThumbnail only serves a part's row to the URL it was
    // fetched from, so a mismatched request costs at most one refetch.
  }

  // Normalize: if the stored value is our proxy URL, use the real Onshape
  // URL for fetching and caching.
  const imageUrl = resolveImageUrl(rawImageUrl);

  // Already points at a locally stored file — redirect straight to it.
  if (storagePathFromUrl(imageUrl)) {
    return redirectTo(imageUrl);
  }

  let cachedPath: string | null = null;
  try {
    cachedPath = findStoredThumbnail(imageUrl, part);
  } catch (error) {
    // An unreadable cache costs one Onshape call, never a broken image.
    console.error("[THUMBNAIL] part_thumbnails lookup failed:", error);
  }

  if (cachedPath) {
    recordOnshapeUsage("thumbnail", "hit");
    return redirectTo(publicUrlForStoragePath(cachedPath));
  }

  // Cache miss — fetch from Onshape. Only ever from Onshape: this request
  // is signed with the server key, and the target may have come from the
  // query string.
  if (!isOnshapeUrl(imageUrl)) {
    return Response.json(
      {
        error:
          "Card image_url is not a fetchable Onshape URL (use an absolute https://*.onshape.com URL)",
      },
      { status: 400 }
    );
  }

  let response: Response;
  try {
    // The signer defaults to `Accept: application/json`, which Onshape
    // answers with 406 for an image (observed 2026-11-09, docs/ONSHAPE.md).
    response = await onshapeFetch(imageUrl, { headers: { Accept: "*/*" } });
    assertOnshapeAllocation(response);
  } catch (error) {
    const known = onshapeErrorResponse(error);
    if (known) return known;
    throw error;
  }
  if (!response.ok) {
    return Response.json(
      { error: `Failed to fetch thumbnail: ${response.statusText}` },
      { status: response.status }
    );
  }

  recordOnshapeUsage("thumbnail", "call");

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("Content-Type") || "image/png";

  // Derive the path from the row key so the same image is not duplicated
  // per card.
  const partKey = part ? partRowKey(part) : null;
  const { hash: keyHash, path: storagePath } = thumbnailStoragePath(
    partKey,
    imageUrl
  );

  const storedUrl = await saveFile(storagePath, buffer);

  if (!storedUrl) {
    console.error("[THUMBNAIL] Storage write failed; serving image inline");
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  // Without a microversion the row gets a synthetic key (the table requires
  // all five key columns) and is found by source_url.
  const rowKey = partKey ?? {
    document_id: `cache_${keyHash}`,
    instance_type: "c",
    instance_id: "0",
    element_id: "0",
    part_id: "0",
  };
  try {
    await db
      .insert(partThumbnails)
      .values({
        ...rowKey,
        storage_path: storagePath,
        source_url: imageUrl,
        microversion_id: part?.microversionId ?? null,
      })
      .onConflictDoUpdate({
        target: [
          partThumbnails.document_id,
          partThumbnails.instance_type,
          partThumbnails.instance_id,
          partThumbnails.element_id,
          partThumbnails.part_id,
        ],
        set: { storage_path: storagePath, source_url: imageUrl },
      });
  } catch (error) {
    console.error("[THUMBNAIL] part_thumbnails upsert failed:", error);
  }

  return redirectTo(storedUrl);
};
