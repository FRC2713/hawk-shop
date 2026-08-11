import { NextRequest, NextResponse } from "next/server";
import {
  deleteEquipment,
  getEquipmentById,
  updateEquipment,
  setEquipmentProcesses,
} from "~/lib/equipmentApi/equipment";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const equipment = await getEquipmentById(id);

    if (!equipment) {
      return NextResponse.json(
        { error: "Equipment not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ equipment });
  } catch (error) {
    console.error("[EQUIPMENT] Error loading equipment:", error);
    return NextResponse.json(
      { error: "Failed to load equipment" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();

    // Prepare updates object, only including provided fields
    const updates: Partial<{
      name: string;
      description: string | null;
      location: string | null;
      status: string | null;
      documentation_url: string | null;
      image_urls: string[] | null;
    }> = {};

    if (body.name !== undefined) {
      updates.name = body.name.trim();
    }
    if (body.description !== undefined) {
      updates.description = body.description || null;
    }
    if (body.location !== undefined) {
      updates.location = body.location || null;
    }
    if (body.status !== undefined) {
      updates.status = body.status || null;
    }
    if (body.documentationUrl !== undefined) {
      updates.documentation_url = body.documentationUrl || null;
    }
    if (body.imageUrls !== undefined) {
      updates.image_urls = (body.imageUrls as string[]) || null;
    }

    const updatedEquipment = await updateEquipment(id, updates);

    // Update processes if provided
    if (body.processIds !== undefined) {
      await setEquipmentProcesses(id, body.processIds || []);
    }

    // Fetch the updated equipment with processes
    const equipmentWithProcesses = await getEquipmentById(id);
    return NextResponse.json({ equipment: equipmentWithProcesses });
  } catch (error) {
    console.error("[EQUIPMENT] Error updating equipment:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Operation failed";
    const statusCode =
      error instanceof Error && error.message === "Equipment not found"
        ? 404
        : 500;
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const deletedEquipment = await deleteEquipment(id);
    return NextResponse.json({ equipment: deletedEquipment });
  } catch (error) {
    console.error("[EQUIPMENT] Error deleting equipment:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Operation failed";
    const statusCode =
      error instanceof Error && error.message === "Equipment not found"
        ? 404
        : 500;
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
