import type { APIRoute } from "astro";
import { requireAuth } from "~/lib/requireAuth";
import { summarizeOnshapeUsage } from "~/lib/onshapeApi/cache";
import { readOnshapeRemaining } from "~/lib/onshapeApi/remaining";

/**
 * What the app has actually spent against the Onshape allocation.
 *
 * Onshape's own usage page reports a single yearly total with no endpoint
 * breakdown, which is not enough to find out where the calls went — so this
 * reports the local tally: `calls` left the building, `hits` were absorbed by
 * the server cache. The ratio is the answer to "is the caching working".
 *
 * `remaining` is the latest `x-rate-limit-remaining` Onshape sent and
 * `remainingByLabel` has one entry per endpoint family. That header is not the
 * yearly allocation, which only Onshape's developer portal shows.
 *
 * Read-only and gated like every other DB-backed route.
 */
export const GET: APIRoute = async () => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  try {
    const remainingByLabel = readOnshapeRemaining();
    const [latest] = remainingByLabel;
    return Response.json({
      ...summarizeOnshapeUsage(),
      remaining: latest
        ? {
            label: latest.label,
            value: latest.value,
            observedAt: latest.observedAt,
            lastStatus: latest.lastStatus,
          }
        : null,
      remainingByLabel,
    });
  } catch (error) {
    console.error("[ONSHAPE USAGE] read failed:", error);
    return Response.json({ error: "Failed to read usage" }, { status: 500 });
  }
};
