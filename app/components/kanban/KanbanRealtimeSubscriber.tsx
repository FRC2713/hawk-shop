"use client";

import { useKanbanRealtime } from "~/lib/kanbanApi/useKanbanRealtime";

export function KanbanRealtimeSubscriber() {
  useKanbanRealtime();
  return null;
}
