import { NextRequest, NextResponse } from "next/server";
import {
  getProcessById,
  updateProcess,
  deleteProcess,
} from "~/lib/processesApi/processes";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const process = await getProcessById(id);

    if (!process) {
      return NextResponse.json({ error: "Process not found" }, { status: 404 });
    }

    return NextResponse.json({ process });
  } catch (error) {
    console.error("[PROCESSES] Error fetching process:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to fetch process";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Build updates object
    const updates: {
      name?: string;
      description?: string | null;
    } = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim() === "") {
        return NextResponse.json(
          { error: "Name must be a non-empty string" },
          { status: 400 }
        );
      }
      updates.name = body.name.trim();
    }

    if (body.description !== undefined) {
      updates.description = body.description || null;
    }

    const updatedProcess = await updateProcess(id, updates);
    return NextResponse.json({ process: updatedProcess });
  } catch (error) {
    console.error("[PROCESSES] Error updating process:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to update process";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const deletedProcess = await deleteProcess(id);
    return NextResponse.json({ process: deletedProcess });
  } catch (error) {
    console.error("[PROCESSES] Error deleting process:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to delete process";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
