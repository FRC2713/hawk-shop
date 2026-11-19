import { Circle, Wrench } from "lucide-react";
import { machineStatusLabels, type MachineStatus } from "~/lib/equipment";
import { cn } from "~/lib/utils";

/** A machine's status as a word plus an icon, so color is never the only cue. */
export function MachineStatusPill({
  status,
  className,
}: {
  status: MachineStatus;
  className?: string;
}) {
  const maintenance = status === "needs-maintenance";
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        maintenance
          ? "border-destructive/40 text-emphasis"
          : "bg-card text-foreground",
        className
      )}
    >
      {maintenance ? (
        <Wrench className="size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <Circle
          className={cn(
            "size-2 shrink-0",
            status === "running"
              ? "fill-status-active text-status-active"
              : "text-muted-foreground"
          )}
          aria-hidden="true"
        />
      )}
      <span className="truncate">{machineStatusLabels[status]}</span>
    </span>
  );
}
