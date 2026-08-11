"use client";

import { useState } from "react";
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
import {
  EquipmentFormFields,
  type EquipmentFormData,
  type EquipmentFormErrors,
} from "./shared/EquipmentFormFields";
import { ImageUploadZone } from "./shared/ImageUploadZone";

interface AddEquipmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddEquipmentDialog({
  open,
  onOpenChange,
}: AddEquipmentDialogProps) {
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

  const createEquipment = useMutation({
    mutationFn: async (data: {
      equipment: EquipmentFormData;
      imageFiles: File[];
    }) => {
      // First, create the equipment
      const response = await fetch("/api/equipment", {
        method: "POST",
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
        throw new Error(error.error || "Failed to create equipment");
      }

      const result = await response.json();
      const equipmentId = result.equipment.id;

      // Then upload images if any
      if (data.imageFiles.length > 0) {
        const uploadPromises = data.imageFiles.map(async (file) => {
          const formData = new FormData();
          formData.append("file", file);

          const uploadResponse = await fetch(
            `/api/equipment/${equipmentId}/image`,
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

      return result.equipment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["equipment"] });
      toast.success("Equipment added successfully");
      handleClose();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to add equipment");
    },
  });

  const handleClose = () => {
    setFormData({
      name: "",
      description: "",
      processIds: [],
      location: "",
      status: "",
      documentationUrl: "",
    });
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

    if (!validateForm()) {
      return;
    }

    createEquipment.mutate({
      equipment: formData,
      imageFiles,
    });
  };

  const handleImageUpload = async (files: File[]) => {
    setImageFiles((prev) => [...prev, ...files]);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Equipment</DialogTitle>
          <DialogDescription>
            Add a new piece of equipment to your FRC shop inventory.
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
              existingImages={[]}
              maxImages={10}
              disabled={createEquipment.isPending}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={createEquipment.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createEquipment.isPending}>
              {createEquipment.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Add Equipment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
