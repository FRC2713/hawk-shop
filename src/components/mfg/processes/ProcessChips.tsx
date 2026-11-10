import { Check } from "lucide-react";
import type { ProcessRow } from "~/server/db/types";
import { cn } from "~/lib/utils";

interface ProcessChipsProps {
  processes: ProcessRow[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}

/** Toggle chips for picking processes; selected chips are filled and checked. */
export function ProcessChips({
  processes,
  selectedIds,
  onChange,
  disabled,
  invalid,
  describedBy,
}: ProcessChipsProps) {
  if (processes.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No processes yet. Add them on the Equipment page.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2" aria-describedby={describedBy}>
      {processes.map((process) => {
        const selected = selectedIds.includes(process.id);
        return (
          <button
            key={process.id}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() =>
              onChange(
                selected
                  ? selectedIds.filter((id) => id !== process.id)
                  : [...selectedIds, process.id]
              )
            }
            className={cn(
              "focus-visible:ring-ring/50 inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors outline-none focus-visible:ring-[3px] disabled:opacity-50",
              selected
                ? "border-foreground bg-foreground text-background"
                : "border-input bg-card text-foreground hover:bg-muted",
              invalid && !selected && "border-destructive"
            )}
          >
            {selected && <Check className="size-3.5" aria-hidden="true" />}
            {process.name}
          </button>
        );
      })}
    </div>
  );
}
