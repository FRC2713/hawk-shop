"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import type { EquipmentRow } from "~/lib/db/types";
import {
  EquipmentFormFields,
  type EquipmentFormData,
  type EquipmentFormErrors,
} from "./shared/EquipmentFormFields";
import { ImageUploadZone } from "./shared/ImageUploadZone";

interface EditEquipmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  equipment: EquipmentRow | null;
}

export function EditEquipmentDialog({
  open,
  onOpenChange,
  equipment,
}: EditEquipmentDialogProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<EquipmentFormData>({
    name: "",
    description: "",
    processIds: [],
    location: "",
    status: "",
    documentationUrl: "",
  });
  const [errors, setErrors] = useState<EquipmentFormErrors>({});
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const existingImages = Array.isArray(equipment?.image_urls)
    ? equipment.image_urls
    : [];

  useEffect(() => {
    if (equipment) {
      // Extract process IDs from equipment (if it has processes property)
      const processIds =
        (equipment as any).processes?.map((p: any) => p.id) || [];
      setFormData({
        name: equipment.name || "",
        description: equipment.description || "",
        processIds,
        location: equipment.location || "",
        status: (equipment.status as EquipmentFormData["status"]) || "",
        documentationUrl: equipment.documentation_url || "",
      });
      setImageFiles([]);
    }
  }, [equipment]);

  const updateEquipment = useMutation({
    mutationFn: async (data: {
      equipmentId: string;
      equipment: EquipmentFormData;
      imageFiles: File[];
    }) => {
      // Update the equipment
      const response = await fetch(`/api/equipment/${data.equipmentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.equipment.name,
          description: data.equipment.description || undefined,
          processIds: data.equipment.processIds || [],
          location: data.equipment.location || undefined,
          status: data.equipment.status || undefined,
          documentationUrl: data.equipment.documentationUrl || undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update equipment");
      }

      // Upload new images if any
      if (data.imageFiles.length > 0) {
        const uploadPromises = data.imageFiles.map(async (file) => {
          const formData = new FormData();
          formData.append("file", file);

          const uploadResponse = await fetch(
            `/api/equipment/${data.equipmentId}/image`,
            {
              method: "POST",
              body: formData,
            }
          );

          if (!uploadResponse.ok) {
            throw new Error("Failed to upload image");
          }
        });

        await Promise.all(uploadPromises);
      }

      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["equipment"] });
      toast.success("Equipment updated successfully");
      handleClose();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update equipment");
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

  const handleClose = () => {
    setErrors({});
    setImageFiles([]);
    onOpenChange(false);
  };

  const validateForm = (): boolean => {
    const newErrors: EquipmentFormErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = "Name is required";
    }

    if (formData.documentationUrl && formData.documentationUrl.trim()) {
      try {
        new URL(formData.documentationUrl);
      } catch {
        newErrors.documentationUrl = "Please enter a valid URL";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!equipment || !validateForm()) {
      return;
    }

    updateEquipment.mutate({
      equipmentId: equipment.id,
      equipment: formData,
      imageFiles,
    });
  };

  const handleImageUpload = async (files: File[]) => {
    setImageFiles((prev) => [...prev, ...files]);
  };

  const handleDeleteImage = async (imageUrl: string) => {
    await deleteImage.mutateAsync(imageUrl);
  };

  if (!equipment) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Equipment</DialogTitle>
          <DialogDescription>
            Update equipment information and images.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          <EquipmentFormFields
            formData={formData}
            onChange={(field, value) =>
              setFormData((prev) => ({ ...prev, [field]: value }))
            }
            errors={errors}
          />
          <div className="space-y-2">
            <label className="text-sm font-medium">Images</label>
            <ImageUploadZone
              onUpload={handleImageUpload}
              existingImages={existingImages}
              onDeleteImage={handleDeleteImage}
              maxImages={10}
              disabled={updateEquipment.isPending || deleteImage.isPending}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={updateEquipment.isPending || deleteImage.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateEquipment.isPending || deleteImage.isPending}
            >
              {updateEquipment.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
