import { createFileRoute } from "@tanstack/react-router";
import { desc } from "drizzle-orm";
import { db } from "~/lib/db/client";
import { onshapeApiUsage } from "~/lib/db/schema";
import { requireAuth } from "~/lib/requireAuth";

/**
 * What the app has actually spent against the Onshape allocation.
 *
 * Onshape's own usage page reports a single yearly total with no endpoint
 * breakdown, which is not enough to find out where the calls went — so this
 * reports the local tally: `calls` left the building, `hits` were absorbed by
 * the server cache. The ratio is the answer to "is the caching working".
 *
 * Read-only and gated like every other DB-backed route.
 */
export const Route = createFileRoute("/api/onshape/usage")({
  server: {
    handlers: {
      GET: async () => {
        const unauthorized = await requireAuth();
        if (unauthorized) return unauthorized;

        try {
          const rows = await db
            .select()
            .from(onshapeApiUsage)
            .orderBy(desc(onshapeApiUsage.day));

          const totals = rows.reduce(
            (acc, row) => {
              acc.calls += row.calls;
              acc.hits += row.hits;
              return acc;
            },
            { calls: 0, hits: 0 }
          );

          const attempted = totals.calls + totals.hits;

          return Response.json({
            totals: {
              ...totals,
              attempted,
              // Share of would-be Onshape calls this cache absorbed.
              hitRate:
                attempted === 0
                  ? 0
                  : Math.round((totals.hits / attempted) * 1000) / 10,
            },
            byDay: rows,
          });
        } catch (error) {
          console.error("[ONSHAPE USAGE] read failed:", error);
          return Response.json(
            { error: "Failed to read usage" },
            { status: 500 }
          );
        }
      },
    },
  },
});
