import "@tanstack/react-start/server-only";

import { logger } from "~/lib/logger";
import {
  deleteFileByUrl,
  sanitizeFileName,
  saveFile,
} from "~/lib/storage/files";

/**
 * Store an equipment image and return its public URL.
 * @param file - The file to upload (File or Buffer)
 * @param equipmentId - The equipment ID to associate with the image
 * @returns The public URL of the stored image, or null if the write fails
 */
export async function uploadEquipmentImage(
  file: File | Buffer,
  equipmentId: string
): Promise<string | null> {
  try {
    let buffer: Buffer;
    let fileName: string;

    if (file instanceof File) {
      buffer = Buffer.from(await file.arrayBuffer());
      fileName = `${equipmentId}-${Date.now()}-${sanitizeFileName(file.name)}`;
    } else {
      buffer = file;
      fileName = `${equipmentId}-${Date.now()}.jpg`;
    }

    return await saveFile(`equipment-images/${fileName}`, buffer);
  } catch (error) {
    logger.error("[EQUIPMENT IMAGES] Error uploading image:", error);
    return null;
  }
}

/**
 * Delete an equipment image from local storage.
 * A no-op for URLs we don't host, and never throws — deleting the equipment
 * itself must succeed even if the image is already gone.
 */
export async function deleteEquipmentImage(
  imageUrl: string | undefined | null
): Promise<void> {
  await deleteFileByUrl(imageUrl);
}
