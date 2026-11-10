import { logServerError } from "~/server/errors";
import type { APIRoute } from "astro";
import { requireSessionActor } from "~/lib/sessionActor";
import {
  getEquipmentById,
  setEquipmentMaintenance,
} from "~/server/equipmentApi/equipment";

const MAX_NOTE_LENGTH = 1000;

function failure(error: unknown) {
  const errorId = logServerError("EQUIPMENT MAINTENANCE", error);
  const notFound =
    error instanceof Error && error.message === "Equipment not found";
  return Response.json(
    {
      error: notFound ? "Equipment not found" : "Failed to update maintenance",
      errorId,
    },
    { status: notFound ? 404 : 500 }
  );
}

/** Flag equipment for maintenance. Body: `{ note: string }`. */
export const POST: APIRoute = async ({ request, params }) => {
  const actor = await requireSessionActor();
  if (actor instanceof Response) return actor;

  const id = params.id!;
  let note: unknown;
  try {
    ({ note } = await request.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof note !== "string" || note.trim() === "") {
    return Response.json(
      { error: "Describe what needs fixing." },
      { status: 400 }
    );
  }
  if (note.length > MAX_NOTE_LENGTH) {
    return Response.json(
      { error: `Keep the note under ${MAX_NOTE_LENGTH} characters.` },
      { status: 400 }
    );
  }

  try {
    await setEquipmentMaintenance(id, {
      note: note.trim(),
      reportedBy: actor.name || actor.email || "Unknown",
    });
    return Response.json({ equipment: await getEquipmentById(id) });
  } catch (error) {
    return failure(error);
  }
};

/** Clear the maintenance flag. */
export const DELETE: APIRoute = async ({ params }) => {
  const actor = await requireSessionActor();
  if (actor instanceof Response) return actor;

  const id = params.id!;
  try {
    await setEquipmentMaintenance(id, null);
    return Response.json({ equipment: await getEquipmentById(id) });
  } catch (error) {
    return failure(error);
  }
};
