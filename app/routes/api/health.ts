import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { db } from "~/lib/db/client";

/**
 * Liveness/readiness probe for the container. Touches SQLite so an unwritable or
 * unmigrated volume shows up as unhealthy rather than as failures later.
 */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => {
        try {
          db.get(sql`select 1`);
          return Response.json({ status: "ok" });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "unknown error";
          return Response.json(
            { status: "error", error: message },
            { status: 503 }
          );
        }
      },
    },
  },
});
