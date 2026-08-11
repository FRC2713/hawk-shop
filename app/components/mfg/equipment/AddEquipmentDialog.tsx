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
import {
  createEquipment as createEquipmentRequest,
  queryKeys,
  uploadEquipmentImages,
} from "~/lib/api";

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
      const equipment = await createEquipmentRequest(data.equipment);
      await uploadEquipmentImages(equipment.id, data.imageFiles);
      return equipment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.equipment.all() });
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
