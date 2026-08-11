import { NextResponse } from "next/server";
import { listUsers } from "~/lib/db/users";

export async function GET() {
  try {
    return NextResponse.json(await listUsers());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list users";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
