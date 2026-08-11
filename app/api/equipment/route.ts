import { NextRequest, NextResponse } from "next/server";
import {
  createEquipment,
  getEquipment,
  setEquipmentProcesses,
} from "~/lib/equipmentApi/equipment";

export async function GET(request: NextRequest) {
  try {
    const result = await getEquipment();

    if (result.error) {
      console.error("[EQUIPMENT] Error loading equipment:", result.error);
      return NextResponse.json(
        { equipment: [], error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({ equipment: result.equipment });
  } catch (error) {
    console.error("[EQUIPMENT] Error loading equipment:", error);
    return NextResponse.json({ equipment: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required field (name is required)
    if (
      !body.name ||
      typeof body.name !== "string" ||
      body.name.trim() === ""
    ) {
      return NextResponse.json(
        { error: "Missing required field: name" },
        { status: 400 }
      );
    }

    // Create the equipment
    const newEquipment = await createEquipment({
      id: body.id,
      name: body.name.trim(),
      description: body.description,
      location: body.location,
      status: body.status,
      documentationUrl: body.documentationUrl,
      imageUrls: body.imageUrls,
      processIds: body.processIds || [],
    });

    return NextResponse.json({ equipment: newEquipment }, { status: 201 });
  } catch (error) {
    console.error("[EQUIPMENT] Error creating equipment:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to create equipment";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
