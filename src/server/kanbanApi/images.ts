import "virtual:hawk-shop/server-only";

import { logger } from "~/lib/logger";
import {
  deleteFileByUrl,
  saveFile,
  storagePathFromUrl,
} from "~/server/storage/files";
import { onshapeFetch, onshapeOrigin } from "~/lib/onshapeApi/auth";

interface ThumbnailParams {
  documentId: string;
  instanceType: string;
  instanceId: string;
  elementId: string;
  partId: string;
}

/**
 * Build Onshape thumbnail URL from individual parameters
 */
function buildOnshapeThumbnailUrl(params: ThumbnailParams): string {
  const { documentId, instanceType, instanceId, elementId, partId } = params;
  // Use the Onshape API v10 thumbnail endpoint format
  // wvm = workspace/version/microversion type indicator
  const wvm = instanceType === "w" ? "w" : instanceType === "v" ? "v" : "m";
  return `${onshapeOrigin()}/api/v10/thumbnails/d/${documentId}/${wvm}/${instanceId}/e/${elementId}/p/${encodeURIComponent(partId)}?outputFormat=PNG&pixelSize=300`;
}

/**
 * Fetch an Onshape thumbnail and copy it into local storage.
 * Returns the public URL of the stored image.
 */
export async function uploadOnshapeThumbnail(
  request: Request,
  params: ThumbnailParams
): Promise<string | null> {
  try {
    const response = await onshapeFetch(buildOnshapeThumbnailUrl(params));
    if (!response.ok) {
      logger.error(
        `[Images] Failed to fetch thumbnail from Onshape: ${response.status}`
      );
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const fileName = `card-images/${params.partId}-${Date.now()}.png`;

    return await saveFile(fileName, buffer);
  } catch (error) {
    logger.error("[Images] Error processing thumbnail:", error);
    return null;
  }
}

/**
 * Delete a card's own uploaded image from local storage.
 *
 * Deliberately scoped to `card-images/`: a card's image_url can also point at a
 * `thumbnails/` entry, which is content-addressed and shared by every card
 * showing the same part, so removing it would blank out the others.
 */
export async function deleteCardImage(
  imageUrl: string | undefined | null
): Promise<void> {
  const storagePath = storagePathFromUrl(imageUrl);
  if (!storagePath || !storagePath.startsWith("card-images/")) {
    return;
  }
  await deleteFileByUrl(imageUrl);
}
