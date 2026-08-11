import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "~/lib/db/client";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe for the container. Touches SQLite so an unwritable or
 * unmigrated volume shows up as unhealthy rather than as failures later.
 */
export async function GET() {
  try {
    db.get(sql`select 1`);
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json(
      { status: "error", error: message },
      { status: 503 }
    );
  }
}
