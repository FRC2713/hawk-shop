import type { KanbanColumn } from "~/server/kanbanApi/columnTypes";
import { Badge } from "~/components/ui/badge";

/**
 * Reusable component for displaying a manufacturing state badge
 */
export function ManufacturingStateBadge({ column }: { column: KanbanColumn }) {
  return (
    <Badge variant="secondary" className="border-border">
      {column.title}
    </Badge>
  );
}
