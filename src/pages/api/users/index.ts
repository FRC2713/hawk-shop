import type { APIRoute } from "astro";
import { requireAuth } from "~/lib/requireAuth";
import { listUsers } from "~/server/db/users";

export const GET: APIRoute = async () => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  try {
    return Response.json(await listUsers());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list users";
    return Response.json({ error: message }, { status: 500 });
  }
};
