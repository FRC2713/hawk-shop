import "server-only";

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "~/lib/db/client";
import { logger } from "~/lib/logger";

/**
 * Local replacement for Supabase Storage.
 *
 * Files live under DATA_DIR/uploads and are addressed by a *relative* storage
 * path (e.g. `thumbnails/ab12.png`). Nothing outside this module should build
 * absolute filesystem paths — `resolveStoragePath` is the only place that joins
 * user-influenced strings onto the uploads root, and it refuses anything that
 * escapes it.
 */

export const UPLOADS_DIR = path.resolve(
  /* turbopackIgnore: true */ process.env.UPLOADS_DIR ||
    path.join(DATA_DIR, "uploads")
);

/** URL prefix that `app/api/files/[...path]/route.ts` serves from. */
export const FILES_URL_PREFIX = "/api/files";

/**
 * Turn a relative storage path into an absolute one, rejecting traversal.
 * Returns null when the path would land outside UPLOADS_DIR.
 */
export function resolveStoragePath(storagePath: string): string | null {
  const normalized = path
    .normalize(storagePath)
    .replace(/^(\.\.(\/|\\|$))+/, "")
    .replace(/^[/\\]+/, "");

  if (!normalized || normalized === ".") {
    return null;
  }

  const absolute = path.resolve(UPLOADS_DIR, normalized);
  const root = UPLOADS_DIR.endsWith(path.sep)
    ? UPLOADS_DIR
    : UPLOADS_DIR + path.sep;

  if (absolute !== UPLOADS_DIR && !absolute.startsWith(root)) {
    return null;
  }

  return absolute;
}

/** Public URL the browser uses to fetch a stored file. */
export function publicUrlForStoragePath(storagePath: string): string {
  const clean = storagePath.replace(/^[/\\]+/, "");
  return `${FILES_URL_PREFIX}/${clean
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

/**
 * Inverse of publicUrlForStoragePath. Returns null for URLs that aren't ours —
 * an externally hosted image, say — so callers can skip deleting them.
 */
export function storagePathFromUrl(
  url: string | undefined | null
): string | null {
  if (!url) return null;

  try {
    // The stored value may be relative ("/api/files/x.png") or absolute; the
    // base is only there to make relative URLs parseable.
    const parsed = new URL(url, "http://localhost");
    if (!parsed.pathname.startsWith(`${FILES_URL_PREFIX}/`)) {
      return null;
    }
    const encoded = parsed.pathname.slice(FILES_URL_PREFIX.length + 1);
    if (!encoded) return null;
    return encoded
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return null;
  }
}

/**
 * Write a file into local storage and return its public URL.
 * `storagePath` is relative to the uploads root and may contain subdirectories.
 */
export async function saveFile(
  storagePath: string,
  data: Buffer
): Promise<string | null> {
  const absolute = resolveStoragePath(storagePath);
  if (!absolute) {
    logger.error(`[STORAGE] Refusing to write outside uploads: ${storagePath}`);
    return null;
  }

  try {
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, data);
    return publicUrlForStoragePath(storagePath);
  } catch (error) {
    logger.error(`[STORAGE] Failed to write ${storagePath}:`, error);
    return null;
  }
}

/** Read a stored file. Returns null when it is missing or out of bounds. */
export async function readStoredFile(
  storagePath: string
): Promise<Buffer | null> {
  const absolute = resolveStoragePath(storagePath);
  if (!absolute) return null;

  try {
    // The path is a runtime value under UPLOADS_DIR, already bounds-checked by
    // resolveStoragePath; without this the bundler traces the whole project in.
    return await readFile(/* turbopackIgnore: true */ absolute);
  } catch {
    return null;
  }
}

/**
 * Delete a stored file given its public URL. A no-op for URLs we don't own, and
 * never throws — deleting a card or equipment item must still succeed when its
 * image is already gone.
 */
export async function deleteFileByUrl(
  url: string | undefined | null
): Promise<void> {
  const storagePath = storagePathFromUrl(url);
  if (!storagePath) return;

  const absolute = resolveStoragePath(storagePath);
  if (!absolute) return;

  try {
    await unlink(absolute);
    logger.debug(`[STORAGE] Deleted ${storagePath}`);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      logger.error(`[STORAGE] Failed to delete ${storagePath}:`, error);
    }
  }
}

/** Best-effort content type from a file extension, for the files route. */
export function contentTypeForPath(storagePath: string): string {
  const ext = path.extname(storagePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

/**
 * Build a filesystem-safe name from an uploaded file's original name.
 */
export function sanitizeFileName(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .slice(-80) || "upload"
  );
}
