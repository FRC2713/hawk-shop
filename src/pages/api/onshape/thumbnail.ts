import { createHash } from "node:crypto";
import type { APIRoute } from "astro";
import { requireAuth } from "~/lib/requireAuth";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "~/server/db/client";
import { kanbanCards, partThumbnails } from "~/server/db/schema";
import { recordOnshapeUsage } from "~/lib/onshapeApi/cache";
import type { OnshapePartMicroversion } from "~/lib/api/onshape";
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
 * If image_url was stored as our proxy URL (/api/onshape/thumbnail?url=...), extract the real
 * Onshape URL so we can fetch and cache by it. Otherwise return as-is.
 */
function resolveImageUrl(imageUrl: string): string {
  const trimmed = imageUrl.trim();
  if (
    !trimmed.includes("/api/onshape/thumbnail") ||
    !trimmed.includes("url=")
  ) {
    return trimmed;
  }
  try {
    const idx = trimmed.indexOf("?");
    if (idx === -1) return trimmed;
    const params = new URLSearchParams(trimmed.slice(idx));
    const real = params.get("url");
    if (real) return real;
  } catch {
    // ignore
  }
  return trimmed;
}

/** The part and microversion a request names, when it names all four. */
function partFrom(fields: {
  documentId?: string | null;
  elementId?: string | null;
  partId?: string | null;
  microversionId?: string | null;
}): OnshapePartMicroversion | null {
  const { documentId, elementId, partId, microversionId } = fields;
  if (!documentId || !elementId || !partId || !microversionId) return null;
  return { documentId, elementId, partId, microversionId };
}

/**
 * Does this Onshape thumbnail URL show this part? Its path names the document,
 * element and part (`/thumbnails/d/<doc>/w/<ws>/e/<element>/p/<part>`), so a
 * `?url=` request can only key its image under the part the URL is for.
 */
function urlShowsPart(
  imageUrl: string,
  part: OnshapePartMicroversion
): boolean {
  let segments: string[];
  try {
    segments = new URL(imageUrl).pathname.split("/").map(decodeURIComponent);
  } catch {
    return false;
  }
  const after = (marker: string) => {
    const index = segments.indexOf(marker);
    return index === -1 ? undefined : segments[index + 1];
  };
  return (
    after("d") === part.documentId &&
    after("e") === part.elementId &&
    after("p") === part.partId
  );
}

type PartThumbnailKey = {
  document_id: string;
  instance_type: string;
  instance_id: string;
  element_id: string;
  part_id: string;
};

/**
 * The `part_thumbnails` primary key for a microversion-keyed row. This is the
 * one definition of a part thumbnail's key; the stored file's name hashes it.
 */
function partRowKey(part: OnshapePartMicroversion): PartThumbnailKey {
  return {
    document_id: part.documentId,
    instance_type: "m",
    instance_id: part.microversionId,
    element_id: part.elementId,
    part_id: part.partId,
  };
}

/** Where a fetched image is stored: one file per row key or source URL. */
function thumbnailStoragePath(key: PartThumbnailKey | null, imageUrl: string) {
  const name = key
    ? // Same string the files were first named by, so existing paths hold.
      [
        "thumbnail",
        key.document_id,
        key.element_id,
        key.part_id,
        key.instance_id,
      ].join("::")
    : imageUrl;
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 32);
  return { hash, path: `thumbnails/${hash}.png` };
}

/** Matches the one `part_thumbnails` row with this primary key. */
function rowIs(key: PartThumbnailKey) {
  return and(
    eq(partThumbnails.document_id, key.document_id),
    eq(partThumbnails.instance_type, key.instance_type),
    eq(partThumbnails.instance_id, key.instance_id),
    eq(partThumbnails.element_id, key.element_id),
    eq(partThumbnails.part_id, key.part_id)
  );
}

/**
 * Find a stored thumbnail for this request.
 *
 * With a microversion, only that microversion's row counts: a workspace
 * thumbnail URL stays the same when the part changes, so matching by URL would
 * serve the old shape. A legacy row (stored before microversion keys, so with
 * no `microversion_id`) for the same URL is adopted once as this
 * microversion's image, so upgrading refetches nothing.
 *
 * Without a microversion (old card, old client) the lookup is by URL, as it
 * always was.
 */
function findStoredThumbnail(
  imageUrl: string,
  part: OnshapePartMicroversion | null
): string | null {
  if (!part) {
    const row = db
      .select({ storage_path: partThumbnails.storage_path })
      .from(partThumbnails)
      .where(eq(partThumbnails.source_url, imageUrl))
      .orderBy(desc(partThumbnails.created_at))
      .limit(1)
      .get();
    return row?.storage_path ?? null;
  }

  const key = partRowKey(part);
  return db.transaction((tx) => {
    const current = tx
      .select({ storage_path: partThumbnails.storage_path })
      .from(partThumbnails)
      .where(rowIs(key))
      .get();
    if (current) return current.storage_path;

    const legacy = tx
      .select()
      .from(partThumbnails)
      .where(
        and(
          eq(partThumbnails.source_url, imageUrl),
          isNull(partThumbnails.microversion_id)
        )
      )
      .limit(1)
      .get();
    if (!legacy) return null;

    // Claim it, so the part's next microversion can't adopt the same old image.
    tx.update(partThumbnails)
      .set({ microversion_id: part.microversionId })
      .where(rowIs(legacy))
      .run();
    tx.insert(partThumbnails)
      .values({
        ...key,
        storage_path: legacy.storage_path,
        source_url: imageUrl,
        microversion_id: part.microversionId,
      })
      .onConflictDoNothing()
      .run();
    return legacy.storage_path;
  });
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
    // The ids come from the caller. Key by them only when the URL is that
    // part's own thumbnail; otherwise one part could overwrite another's row.
    if (part && !urlShowsPart(resolveImageUrl(rawImageUrl), part)) part = null;
  }

  // Normalize: if the stored value is our proxy URL, use the real Onshape
  // URL for fetching and caching.
  const imageUrl = resolveImageUrl(rawImageUrl);

  // Already points at a locally stored file — redirect straight to it.
  if (storagePathFromUrl(imageUrl)) {
    return Response.redirect(
      new URL(imageUrl, requestUrl.origin).toString(),
      307
    );
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
    return Response.redirect(
      new URL(
        publicUrlForStoragePath(cachedPath),
        requestUrl.origin
      ).toString(),
      307
    );
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
    response = await onshapeFetch(imageUrl);
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

  return Response.redirect(
    new URL(storedUrl, requestUrl.origin).toString(),
    307
  );
};
