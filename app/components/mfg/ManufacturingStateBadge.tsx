import type { KanbanColumn } from "~/lib/kanbanApi/columnTypes";
import { Badge } from "~/components/ui/badge";
import { getColumnColorClasses } from "~/onshape_connector/utils/columnColors";

/**
 * Reusable component for displaying a manufacturing state badge
 */
export function ManufacturingStateBadge({ column }: { column: KanbanColumn }) {
  // Kanban columns don't have colors yet, so we'll use position to determine color
  const colorIndex = column.position % 6;
  const colors = ["yellow", "blue", "green", "orange", "purple", "red"];
  const { bg, text } = getColumnColorClasses(colors[colorIndex]);

  return (
    <Badge className={`${bg} ${text} border-transparent`}>{column.title}</Badge>
  );
}
