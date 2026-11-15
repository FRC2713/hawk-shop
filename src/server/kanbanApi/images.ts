import "virtual:hawk-shop/server-only";

import { deleteFileByUrl, storagePathFromUrl } from "~/server/storage/files";

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
