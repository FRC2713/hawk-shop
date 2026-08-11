import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "~/lib/db/client";
import { kanbanCards, partThumbnails } from "~/lib/db/schema";
import {
  publicUrlForStoragePath,
  saveFile,
  storagePathFromUrl,
} from "~/lib/storage/files";
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
 * Thumbnail endpoint for kanban cards only.
 * GET ?cardId=<id> — looks up the card's image_url, checks part_thumbnails by
 * source_url, and on a miss fetches from Onshape, stores it locally and
 * redirects to the stored copy.
 */
export async function GET(request: NextRequest) {
  const cardId = request.nextUrl.searchParams.get("cardId");
  if (!cardId) {
    return NextResponse.json({ error: "Missing cardId" }, { status: 400 });
  }

  const [card] = await db
    .select({ image_url: kanbanCards.image_url })
    .from(kanbanCards)
    .where(eq(kanbanCards.id, cardId))
    .limit(1);

  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const rawImageUrl = card.image_url?.trim() || null;
  if (!rawImageUrl) {
    return NextResponse.json(
      { error: "Card has no image_url" },
      { status: 404 }
    );
  }

  // Normalize: if the stored value is our proxy URL, use the real Onshape URL
  // for fetching and caching.
  const imageUrl = resolveImageUrl(rawImageUrl);

  // Already points at a locally stored file — redirect straight to it.
  if (storagePathFromUrl(imageUrl)) {
    return NextResponse.redirect(
      new URL(imageUrl, request.nextUrl.origin),
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
    return NextResponse.redirect(
      new URL(
        publicUrlForStoragePath(cached.storage_path),
        request.nextUrl.origin
      ),
      307
    );
  }

  // Cache miss — fetch from Onshape (requires absolute URL)
  if (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://")) {
    return NextResponse.json(
      {
        error:
          "Card image_url is not a fetchable URL (use an absolute Onshape URL)",
      },
      { status: 400 }
    );
  }

  const accessToken = await refreshOnshapeTokenIfNeeded();
  if (!accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const response = await fetch(imageUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: `Failed to fetch thumbnail: ${response.statusText}` },
      { status: response.status }
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("Content-Type") || "image/png";

  // Derive the path from source_url so the same image is not duplicated per card
  const keyHash = createHash("sha256")
    .update(imageUrl)
    .digest("hex")
    .slice(0, 32);
  const storagePath = `thumbnails/${keyHash}.png`;

  const storedUrl = await saveFile(storagePath, buffer);

  if (!storedUrl) {
    console.error("[THUMBNAIL] Storage write failed; serving image inline");
    return new NextResponse(new Uint8Array(buffer), {
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

  return NextResponse.redirect(new URL(storedUrl, request.nextUrl.origin), 307);
}
