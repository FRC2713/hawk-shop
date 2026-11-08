import { createHash } from "node:crypto";
import type { APIRoute } from "astro";
import { requireAuth } from "~/lib/requireAuth";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/client";
import { kanbanCards, partThumbnails } from "~/server/db/schema";
import { recordOnshapeUsage } from "~/lib/onshapeApi/cache";
import {
  publicUrlForStoragePath,
  saveFile,
  storagePathFromUrl,
} from "~/server/storage/files";
import { refreshOnshapeTokenIfNeeded } from "~/lib/tokenRefresh";

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

/**
 * Whether a caller-supplied URL is safe to fetch with the user's Onshape token.
 *
 * This matters because the `?url=` form takes its target straight from the
 * query string and then attaches `Authorization: Bearer <token>` to it. Without
 * this check, anyone who could reach the app could point it at a host they
 * control and be handed a live Onshape access token. Onshape enterprises get
 * their own subdomain, so the allowlist is the apex domain and anything under
 * it — over HTTPS only.
 */
function isOnshapeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return (
      url.hostname === "onshape.com" || url.hostname.endsWith(".onshape.com")
    );
  } catch {
    return false;
  }
}

/**
 * Thumbnail endpoint for kanban cards and connector part lists.
 *
 * GET ?cardId=<id> — resolves the card's stored `image_url`.
 * GET ?url=<onshape url> — used by the connector, which has the part's
 *   thumbnail href from the parts query but no card yet.
 *
 * Both forms converge on the same `part_thumbnails` cache, keyed by
 * `source_url`, so an image is fetched from Onshape exactly once no matter how
 * many cards or part rows display it. That sharing is the whole point: a
 * 150-part studio would otherwise cost 150 calls against an annual allocation
 * every time someone opened the connector.
 */
export const GET: APIRoute = async ({ request }) => {
  // Gated like the other DB-backed routes: a cache hit answers straight
  // from `part_thumbnails` and never reaches Onshape, so needing a token
  // is not by itself a gate here.
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const requestUrl = new URL(request.url);
  const cardId = requestUrl.searchParams.get("cardId");
  const directUrl = requestUrl.searchParams.get("url");

  if (!cardId && !directUrl) {
    return Response.json({ error: "Missing cardId or url" }, { status: 400 });
  }

  let rawImageUrl: string | null = null;

  if (cardId) {
    const [card] = await db
      .select({ image_url: kanbanCards.image_url })
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
  } else {
    rawImageUrl = directUrl!.trim() || null;
    if (!rawImageUrl) {
      return Response.json({ error: "Empty url" }, { status: 400 });
    }
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

  // Look up cache by source_url (resolved image URL)
  const [cached] = await db
    .select({ storage_path: partThumbnails.storage_path })
    .from(partThumbnails)
    .where(eq(partThumbnails.source_url, imageUrl))
    .limit(1);

  if (cached?.storage_path) {
    recordOnshapeUsage("thumbnail", "hit");
    return Response.redirect(
      new URL(
        publicUrlForStoragePath(cached.storage_path),
        requestUrl.origin
      ).toString(),
      307
    );
  }

  // Cache miss — fetch from Onshape. Only ever from Onshape: this request
  // carries a bearer token, and the target may have come from the query
  // string.
  if (!isOnshapeUrl(imageUrl)) {
    return Response.json(
      {
        error:
          "Card image_url is not a fetchable Onshape URL (use an absolute https://*.onshape.com URL)",
      },
      { status: 400 }
    );
  }

  const accessToken = await refreshOnshapeTokenIfNeeded();
  if (!accessToken) {
    return Response.json({ error: "Not authenticated" }, { status: 409 });
  }

  const response = await fetch(imageUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    return Response.json(
      { error: `Failed to fetch thumbnail: ${response.statusText}` },
      { status: response.status }
    );
  }

  recordOnshapeUsage("thumbnail", "call");

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("Content-Type") || "image/png";

  // Derive the path from source_url so the same image is not duplicated
  // per card
  const keyHash = createHash("sha256")
    .update(imageUrl)
    .digest("hex")
    .slice(0, 32);
  const storagePath = `thumbnails/${keyHash}.png`;

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

  // Synthetic PK for part_thumbnails (the table requires all 5 key columns)
  try {
    await db
      .insert(partThumbnails)
      .values({
        document_id: `cache_${keyHash}`,
        instance_type: "c",
        instance_id: "0",
        element_id: "0",
        part_id: "0",
        storage_path: storagePath,
        source_url: imageUrl,
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
