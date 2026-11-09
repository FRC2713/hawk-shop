import { useKanbanRealtime } from "~/hooks/useKanbanRealtime";

export function KanbanRealtimeSubscriber() {
  useKanbanRealtime();
  return null;
}
