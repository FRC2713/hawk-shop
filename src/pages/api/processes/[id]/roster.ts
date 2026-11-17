import type { APIRoute } from "astro";
import { requireAuth } from "~/lib/requireAuth";
import { changeStationRoster, listStationRoster } from "~/server/stationRoster";
import { workflowErrorResponse } from "~/server/kanbanApi/workflowResponses";

export const GET: APIRoute = async ({ params }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    return Response.json(listStationRoster(params.id!));
  } catch (error) {
    return workflowErrorResponse("STATION ROSTER", error);
  }
};
const change: APIRoute = async ({ request, params }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json().catch(() => null);
    return Response.json(
      changeStationRoster(params.id!, body?.userId, request.method === "DELETE")
    );
  } catch (error) {
    return workflowErrorResponse("STATION ROSTER", error);
  }
};
export const POST = change;
export const DELETE = change;
