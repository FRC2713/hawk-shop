import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "~/lib/requireAuth";
import { getUserRecordById } from "~/lib/db/users";

export const Route = createFileRoute("/api/users/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const unauthorized = await requireAuth();
        if (unauthorized) return unauthorized;

        const user = await getUserRecordById(params.id);
        if (!user) {
          return Response.json({ error: "User not found" }, { status: 404 });
        }
        return Response.json(user);
      },
    },
  },
});
