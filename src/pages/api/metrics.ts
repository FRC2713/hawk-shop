import { logServerError } from "~/server/errors";
import type { APIRoute } from "astro";
import { requireAuth } from "~/lib/requireAuth";
import { getMetrics, parseMetricsRange } from "~/server/kanbanApi/metrics";

export const GET: APIRoute = async ({ url }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  let range;
  try {
    range = parseMetricsRange(url.searchParams);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
  try {
    return Response.json(await getMetrics(range));
  } catch (error) {
    return Response.json(
      {
        error: "Shop metrics could not be loaded.",
        errorId: logServerError("METRICS", error),
      },
      { status: 500 }
    );
  }
};
