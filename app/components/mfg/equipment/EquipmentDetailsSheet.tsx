"use client";

import { ExternalLink, MapPin } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import type { EquipmentRow, ProcessRow } from "~/lib/db/types";
import { EquipmentProcessChip } from "./shared/EquipmentCategoryChip";
import { EquipmentStatusBadge } from "./shared/EquipmentStatusBadge";
import { EquipmentActionsMenu } from "./shared/EquipmentActionsMenu";
import { EquipmentImageGallery } from "./EquipmentImageGallery";

interface EquipmentDetailsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  equipment: (EquipmentRow & { processes?: ProcessRow[] }) | null;
  onEdit: () => void;
  onDelete: () => void;
}

export function EquipmentDetailsSheet({
  open,
  onOpenChange,
  equipment,
  onEdit,
  onDelete,
}: EquipmentDetailsSheetProps) {
  const queryClient = useQueryClient();

  const uploadImage = useMutation({
    mutationFn: async (files: File[]) => {
      if (!equipment) return;

      const uploadPromises = files.map(async (file) => {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(`/api/equipment/${equipment.id}/image`, {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error("Failed to upload image");
        }
      });

      await Promise.all(uploadPromises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["equipment"] });
      toast.success("Image uploaded successfully");
    },
    onError: () => {
      toast.error("Failed to upload image");
    },
  });

  const deleteImage = useMutation({
    mutationFn: async (imageUrl: string) => {
      if (!equipment) return;

      const response = await fetch(
        `/api/equipment/${equipment.id}/image?imageUrl=${encodeURIComponent(imageUrl)}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        throw new Error("Failed to delete image");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["equipment"] });
      toast.success("Image deleted successfully");
    },
    onError: () => {
      toast.error("Failed to delete image");
    },
  });

  if (!equipment) {
    return null;
  }

  const imageUrls = Array.isArray(equipment.image_urls)
    ? equipment.image_urls
    : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full p-4 text-base sm:max-w-2xl sm:p-6">
        <SheetHeader className="p-0 pr-12">
          <div>
            <SheetTitle className="text-2xl sm:text-3xl">
              {equipment.name}
            </SheetTitle>
            <SheetDescription className="mt-1 text-sm sm:text-base">
              Equipment details and information
            </SheetDescription>
          </div>
        </SheetHeader>
        <div className="absolute top-4 right-12">
          <EquipmentActionsMenu
            equipment={equipment}
            onEdit={onEdit}
            onDelete={onDelete}
            onViewDetails={() => {}} // Already viewing details
          />
        </div>

        <div className="mt-6 space-y-6">
          {/* Status and Processes */}
          <div className="flex flex-wrap items-center gap-2">
            {equipment.processes && equipment.processes.length > 0 && (
              <>
                {equipment.processes.map((process) => (
                  <EquipmentProcessChip key={process.id} process={process} />
                ))}
              </>
            )}
            <EquipmentStatusBadge
              status={
                equipment.status as
                  "available" | "in-use" | "maintenance" | "retired" | null
              }
            />
          </div>

          {/* Location */}
          {equipment.location && (
            <div className="text-muted-foreground flex items-center gap-2">
              <MapPin className="size-4" />
              <span>{equipment.location}</span>
            </div>
          )}

          {/* Description */}
          {equipment.description && (
            <div>
              <h3 className="mb-2 text-base font-semibold">Description</h3>
              <p className="text-muted-foreground text-sm whitespace-pre-wrap sm:text-base">
                {equipment.description}
              </p>
            </div>
          )}

          {/* Documentation Link */}
          {equipment.documentation_url && (
            <div>
              <h3 className="mb-2 text-base font-semibold">Documentation</h3>
              <Button variant="outline" asChild>
                <a
                  href={equipment.documentation_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2"
                >
                  <ExternalLink className="size-4" />
                  Open Documentation
                </a>
              </Button>
            </div>
          )}

          {/* Image Gallery */}
          <div>
            <h3 className="mb-4 text-base font-semibold">Images</h3>
            <EquipmentImageGallery
              images={imageUrls}
              onUpload={async (files) => {
                await uploadImage.mutateAsync(files);
              }}
              onDeleteImage={async (imageUrl) => {
                await deleteImage.mutateAsync(imageUrl);
              }}
              equipmentId={equipment.id}
              maxImages={10}
              disabled={uploadImage.isPending || deleteImage.isPending}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
