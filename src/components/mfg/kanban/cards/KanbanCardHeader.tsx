import { GripVertical } from "lucide-react";
import { Checkbox } from "~/components/ui/checkbox";

interface KanbanCardHeaderProps {
  title: string;
  attributes: React.HTMLAttributes<HTMLDivElement>;
  listeners?: Record<string, Function>;
  isSelected?: boolean;
  onCheckboxClick?: (event: React.MouseEvent) => void;
}

export function KanbanCardHeader({
  title,
  attributes,
  listeners,
  isSelected = false,
  onCheckboxClick,
}: KanbanCardHeaderProps) {
  return (
    <div
      {...attributes}
      {...listeners}
      className="bg-secondary/50 flex w-full cursor-grab items-center justify-start gap-2 rounded-t-xl p-2.5 pb-2"
    >
      {/* Checkbox - Top left */}
      {onCheckboxClick && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onCheckboxClick(e);
          }}
          onMouseDown={(e) => {
            // Prevent drag from starting when clicking checkbox
            e.stopPropagation();
          }}
          onPointerDown={(e) => {
            // Prevent drag from starting when clicking checkbox
            e.stopPropagation();
          }}
          className="z-10 flex cursor-pointer items-center"
        >
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => {
              // Handled by onClick above
            }}
            className="border-foreground/40 dark:border-foreground/60 bg-background/80 dark:bg-background/60 pointer-events-none shadow-sm"
          />
        </div>
      )}

      {/* Drag Handle - Always visible on touch devices, hover-only on desktop */}
      <button
        className="mt-0.5 touch-none opacity-60 transition-opacity group-hover:opacity-100 hover:opacity-100 active:cursor-grabbing active:opacity-100"
        aria-label="Drag to reorder"
      >
        <GripVertical className="text-muted-foreground size-4" />
      </button>

      {/* Title */}
      <h3 className="line-clamp-2 flex-1 text-xs leading-tight font-semibold hover:underline sm:text-sm">
        {title}
      </h3>
    </div>
  );
}
