import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "~/lib/requireAuth";
import {
  deleteEquipment,
  getEquipmentById,
  updateEquipment,
  setEquipmentProcesses,
} from "~/lib/equipmentApi/equipment";

export const Route = createFileRoute("/api/equipment/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const unauthorized = await requireAuth();
        if (unauthorized) return unauthorized;

        const { id } = params;
        try {
          const equipment = await getEquipmentById(id);

          if (!equipment) {
            return Response.json(
              { error: "Equipment not found" },
              { status: 404 }
            );
          }

          return Response.json({ equipment });
        } catch (error) {
          console.error("[EQUIPMENT] Error loading equipment:", error);
          return Response.json(
            { error: "Failed to load equipment" },
            { status: 500 }
          );
        }
      },

      PUT: async ({ request, params }) => {
        const unauthorized = await requireAuth();
        if (unauthorized) return unauthorized;

        const { id } = params;
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
          console.error("[EQUIPMENT] Error updating equipment:", error);
          const errorMessage =
            error instanceof Error ? error.message : "Operation failed";
          const statusCode =
            error instanceof Error && error.message === "Equipment not found"
              ? 404
              : 500;
          return Response.json({ error: errorMessage }, { status: statusCode });
        }
      },

      DELETE: async ({ params }) => {
        const unauthorized = await requireAuth();
        if (unauthorized) return unauthorized;

        const { id } = params;
        try {
          const deletedEquipment = await deleteEquipment(id);
          return Response.json({ equipment: deletedEquipment });
        } catch (error) {
          console.error("[EQUIPMENT] Error deleting equipment:", error);
          const errorMessage =
            error instanceof Error ? error.message : "Operation failed";
          const statusCode =
            error instanceof Error && error.message === "Equipment not found"
              ? 404
              : 500;
          return Response.json({ error: errorMessage }, { status: statusCode });
        }
      },
    },
  },
});
