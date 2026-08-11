import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_CONFIG,
  getKanbanConfig,
  saveKanbanConfig,
} from "~/lib/kanbanApi/config";
import type { KanbanConfig } from "~/lib/kanbanApi/columnTypes";

export type { KanbanColumn, KanbanConfig } from "~/lib/kanbanApi/columnTypes";

export async function GET() {
  try {
    const config = await getKanbanConfig();
    return NextResponse.json(config);
  } catch (error) {
    console.error("[KANBAN CONFIG] Error loading config:", error);
    return NextResponse.json(DEFAULT_CONFIG, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const config = (await request.json()) as KanbanConfig;

    // Validate the config
    if (!config.columns || !Array.isArray(config.columns)) {
      return NextResponse.json(
        { error: "Invalid config structure" },
        { status: 400 }
      );
    }

    await saveKanbanConfig(config);

    return NextResponse.json({ success: true, config });
  } catch (error) {
    console.error("[KANBAN CONFIG] Error saving config:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to save config";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
