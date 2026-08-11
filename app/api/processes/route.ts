import { NextRequest, NextResponse } from "next/server";
import { createProcess, getProcesses } from "~/lib/processesApi/processes";

export async function GET(request: NextRequest) {
  try {
    const result = await getProcesses();

    if (result.error) {
      console.error("[PROCESSES] Error loading processes:", result.error);
      return NextResponse.json(
        { processes: [], error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({ processes: result.processes });
  } catch (error) {
    console.error("[PROCESSES] Error loading processes:", error);
    return NextResponse.json({ processes: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required field (name is required)
    if (
      !body.name ||
      typeof body.name !== "string" ||
      body.name.trim() === ""
    ) {
      return NextResponse.json(
        { error: "Missing required field: name" },
        { status: 400 }
      );
    }

    // Create the process
    const newProcess = await createProcess({
      id: body.id,
      name: body.name.trim(),
      description: body.description,
    });

    return NextResponse.json({ process: newProcess }, { status: 201 });
  } catch (error) {
    console.error("[PROCESSES] Error creating process:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to create process";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
