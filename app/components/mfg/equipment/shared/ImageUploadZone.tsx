"use client";

import { Upload, X } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "~/components/ui/button";
import { ImagePreview } from "./ImagePreview";

interface ImageUploadZoneProps {
  onUpload: (files: File[]) => Promise<void>;
  existingImages?: string[];
  onDeleteImage?: (imageUrl: string) => Promise<void>;
  maxImages?: number;
  disabled?: boolean;
  onPreviewClick?: (index: number) => void;
}

export function ImageUploadZone({
  onUpload,
  existingImages = [],
  onDeleteImage,
  maxImages = 10,
  disabled = false,
  onPreviewClick,
}: ImageUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) {
        setIsDragging(true);
      }
    },
    [disabled]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (disabled) return;

      const files = Array.from(e.dataTransfer.files).filter((file) =>
        file.type.startsWith("image/")
      );

      if (files.length === 0) return;

      const totalImages = existingImages.length + files.length;
      if (totalImages > maxImages) {
        alert(`Maximum ${maxImages} images allowed`);
        return;
      }

      setIsUploading(true);
      try {
        await onUpload(files);
      } catch (error) {
        console.error("Error uploading images:", error);
        // Error toast will be handled by parent component
      } finally {
        setIsUploading(false);
      }
    },
    [disabled, existingImages.length, maxImages, onUpload]
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;

      const files = Array.from(e.target.files || []).filter((file) =>
        file.type.startsWith("image/")
      );

      if (files.length === 0) return;

      const totalImages = existingImages.length + files.length;
      if (totalImages > maxImages) {
        alert(`Maximum ${maxImages} images allowed`);
        return;
      }

      setIsUploading(true);
      try {
        await onUpload(files);
      } catch (error) {
        console.error("Error uploading images:", error);
      } finally {
        setIsUploading(false);
        // Reset input
        e.target.value = "";
      }
    },
    [disabled, existingImages.length, maxImages, onUpload]
  );

  const handleDelete = useCallback(
    async (imageUrl: string) => {
      if (onDeleteImage) {
        await onDeleteImage(imageUrl);
      }
    },
    [onDeleteImage]
  );

  const canAddMore = existingImages.length < maxImages;

  return (
    <div className="space-y-4">
      {existingImages.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {existingImages.map((imageUrl, idx) => (
            <ImagePreview
              key={`${imageUrl}-${idx}`}
              imageUrl={imageUrl}
              onClick={onPreviewClick ? () => onPreviewClick(idx) : undefined}
              onDelete={
                onDeleteImage ? () => handleDelete(imageUrl) : undefined
              }
              showDelete={!!onDeleteImage}
            />
          ))}
        </div>
      )}

      {canAddMore && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
            isDragging
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-muted-foreground/50"
          } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} `}
        >
          <input
            type="file"
            id="image-upload"
            className="hidden"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            disabled={disabled || isUploading}
          />
          <label
            htmlFor="image-upload"
            className={`flex flex-col items-center justify-center gap-2 ${
              disabled || isUploading ? "cursor-not-allowed" : "cursor-pointer"
            }`}
          >
            <Upload
              className={`size-8 ${
                isDragging ? "text-primary" : "text-muted-foreground"
              }`}
            />
            <div className="text-center">
              <p className="text-sm font-medium">
                {isUploading
                  ? "Uploading..."
                  : "Click to upload or drag and drop"}
              </p>
              <p className="text-muted-foreground text-xs">
                Images only (max {maxImages - existingImages.length} more)
              </p>
            </div>
          </label>
        </div>
      )}

      {!canAddMore && (
        <div className="bg-muted/50 text-muted-foreground rounded-lg border p-4 text-center text-sm">
          Maximum {maxImages} images reached
        </div>
      )}
    </div>
  );
}
