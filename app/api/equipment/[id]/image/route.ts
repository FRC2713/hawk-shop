import { NextRequest, NextResponse } from "next/server";
import {
  getEquipmentById,
  updateEquipment,
} from "~/lib/equipmentApi/equipment";
import {
  deleteEquipmentImage,
  uploadEquipmentImage,
} from "~/lib/equipmentApi/images";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // Get the form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "File must be an image" },
        { status: 400 }
      );
    }

    // Upload the image
    const imageUrl = await uploadEquipmentImage(file, id);

    if (!imageUrl) {
      return NextResponse.json(
        { error: "Failed to upload image" },
        { status: 500 }
      );
    }

    // Get current equipment to update image_urls array
    const equipment = await getEquipmentById(id);
    if (!equipment) {
      return NextResponse.json(
        { error: "Equipment not found" },
        { status: 404 }
      );
    }

    // Add the new image URL to the array
    const currentImageUrls = equipment.image_urls || [];
    const updatedImageUrls = [...currentImageUrls, imageUrl];

    // Update the equipment with the new image URL
    await updateEquipment(id, {
      image_urls: updatedImageUrls,
    });

    return NextResponse.json({ imageUrl }, { status: 201 });
  } catch (error) {
    console.error("[EQUIPMENT IMAGE] Error uploading image:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to upload image";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const url = request.nextUrl;
    const imageUrl = url.searchParams.get("imageUrl");

    if (!imageUrl) {
      return NextResponse.json(
        { error: "Missing imageUrl query parameter" },
        { status: 400 }
      );
    }

    // Get current equipment to update image_urls array
    const equipment = await getEquipmentById(id);
    if (!equipment) {
      return NextResponse.json(
        { error: "Equipment not found" },
        { status: 404 }
      );
    }

    // Remove the image URL from the array
    const currentImageUrls = equipment.image_urls || [];
    const updatedImageUrls = currentImageUrls.filter((url) => url !== imageUrl);

    // Delete the image from storage
    await deleteEquipmentImage(imageUrl);

    // Update the equipment with the updated image URLs array
    await updateEquipment(id, {
      image_urls: updatedImageUrls.length > 0 ? updatedImageUrls : null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[EQUIPMENT IMAGE] Error deleting image:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to delete image";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
