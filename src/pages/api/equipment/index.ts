import { logServerError } from "~/server/errors";
import type { APIRoute } from "astro";
import { requireAuth } from "~/lib/requireAuth";
import { createEquipment, getEquipment } from "~/server/equipmentApi/equipment";

export const GET: APIRoute = async () => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  try {
    const result = await getEquipment();

    if (result.error) {
      const errorId =
        result.errorId ?? logServerError("EQUIPMENT", new Error(result.error));
      return Response.json(
        { equipment: [], error: result.error, errorId },
        { status: 500 }
      );
    }

    return Response.json({ equipment: result.equipment });
  } catch (error) {
    const errorId = logServerError("EQUIPMENT", error);
    return Response.json({ equipment: [], errorId }, { status: 500 });
  }
};
export const POST: APIRoute = async ({ request }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();

    // Validate required field (name is required)
    if (
      !body.name ||
      typeof body.name !== "string" ||
      body.name.trim() === ""
    ) {
      return Response.json(
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

    return Response.json({ equipment: newEquipment }, { status: 201 });
  } catch (error) {
    const errorId = logServerError("EQUIPMENT", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to create equipment";
    return Response.json({ error: errorMessage, errorId }, { status: 500 });
  }
};
