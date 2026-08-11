import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "~/lib/requireAuth";
import { createEquipment, getEquipment } from "~/lib/equipmentApi/equipment";

export const Route = createFileRoute("/api/equipment/")({
  server: {
    handlers: {
      GET: async () => {
        const unauthorized = await requireAuth();
        if (unauthorized) return unauthorized;

        try {
          const result = await getEquipment();

          if (result.error) {
            console.error("[EQUIPMENT] Error loading equipment:", result.error);
            return Response.json(
              { equipment: [], error: result.error },
              { status: 500 }
            );
          }

          return Response.json({ equipment: result.equipment });
        } catch (error) {
          console.error("[EQUIPMENT] Error loading equipment:", error);
          return Response.json({ equipment: [] }, { status: 500 });
        }
      },

      POST: async ({ request }) => {
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
          console.error("[EQUIPMENT] Error creating equipment:", error);
          const errorMessage =
            error instanceof Error
              ? error.message
              : "Failed to create equipment";
          return Response.json({ error: errorMessage }, { status: 500 });
        }
      },
    },
  },
});
