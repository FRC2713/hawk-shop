import type { APIRoute } from "astro";
import { requireSlackAdmin } from "~/lib/slack/admin";
import { getSlackStatus } from "~/lib/slack/status";
export const GET: APIRoute = async () => {
  const actor = await requireSlackAdmin();
  if (actor instanceof Response) return actor;
  return Response.json(await getSlackStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
};
