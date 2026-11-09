import { logServerError } from "~/server/errors";
import type { APIRoute } from "astro";
import { requireAuth } from "~/lib/requireAuth";
import {
  deleteEquipment,
  getEquipmentById,
  updateEquipment,
  setEquipmentProcesses,
} from "~/server/equipmentApi/equipment";

export const GET: APIRoute = async ({ params }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const id = params.id!;
  try {
    const equipment = await getEquipmentById(id);

    if (!equipment) {
      return Response.json({ error: "Equipment not found" }, { status: 404 });
    }

    return Response.json({ equipment });
  } catch (error) {
    const errorId = logServerError("EQUIPMENT", error);
    return Response.json(
      { error: "Failed to load equipment", errorId },
      { status: 500 }
    );
  }
};
export const PUT: APIRoute = async ({ request, params }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const id = params.id!;
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

    await updateEquipment(id, updates);

    // Update processes if provided
    if (body.processIds !== undefined) {
      await setEquipmentProcesses(id, body.processIds || []);
    }

    // Fetch the updated equipment with processes
    const equipmentWithProcesses = await getEquipmentById(id);
    return Response.json({ equipment: equipmentWithProcesses });
  } catch (error) {
    const errorId = logServerError("EQUIPMENT", error);
    const errorMessage =
      error instanceof Error ? error.message : "Operation failed";
    const statusCode =
      error instanceof Error && error.message === "Equipment not found"
        ? 404
        : 500;
    return Response.json(
      { error: errorMessage, errorId },
      { status: statusCode }
    );
  }
};
export const DELETE: APIRoute = async ({ params }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const id = params.id!;
  try {
    const deletedEquipment = await deleteEquipment(id);
    return Response.json({ equipment: deletedEquipment });
  } catch (error) {
    const errorId = logServerError("EQUIPMENT", error);
    const errorMessage =
      error instanceof Error ? error.message : "Operation failed";
    const statusCode =
      error instanceof Error && error.message === "Equipment not found"
        ? 404
        : 500;
    return Response.json(
      { error: errorMessage, errorId },
      { status: statusCode }
    );
  }
};
