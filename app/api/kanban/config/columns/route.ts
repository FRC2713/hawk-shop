import { NextResponse } from "next/server";
import { DEFAULT_KANBAN_COLUMNS } from "~/lib/kanbanApi/columnTypes";
import { getKanbanColumns } from "~/lib/kanbanApi/config";

export async function GET() {
  try {
    const columns = await getKanbanColumns();
    return NextResponse.json(columns);
  } catch (error) {
    console.error("[KANBAN COLUMNS] Error loading columns:", error);
    return NextResponse.json(DEFAULT_KANBAN_COLUMNS, { status: 500 });
  }
}
