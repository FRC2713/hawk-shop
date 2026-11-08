import type { APIRoute } from "astro";
import { requireAuth } from "~/lib/requireAuth";
import { getUserRecordById } from "~/server/db/users";

export const GET: APIRoute = async ({ params }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const user = await getUserRecordById(params.id!);
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }
  return Response.json(user);
};
