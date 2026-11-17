import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";
import { cn } from "~/lib/utils";

const STEPS = [
  { id: WORKFLOW_COLUMN_IDS.backlog, label: "Backlog" },
  { id: WORKFLOW_COLUMN_IDS.inProgress, label: "In progress" },
  { id: WORKFLOW_COLUMN_IDS.review, label: "Review" },
  { id: WORKFLOW_COLUMN_IDS.done, label: "Done" },
];

/**
 * A part's status as four steps, filled up to the current one. The current
 * step is `aria-current="step"`. A card in a column outside the workflow
 * fills nothing.
 */
export function StatusBar({
  columnId,
  className,
}: {
  columnId: string;
  className?: string;
}) {
  const current = STEPS.findIndex((step) => step.id === columnId);
  return (
    <ol aria-label="Status" className={cn("grid grid-cols-4 gap-1", className)}>
      {STEPS.map((step, index) => (
        <li
          key={step.id}
          aria-current={index === current ? "step" : undefined}
          className={cn(
            "flex flex-col gap-1.5 text-xs",
            index === current
              ? "text-foreground font-semibold"
              : "text-muted-foreground"
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "h-1 rounded-sm",
              index <= current ? "bg-primary" : "bg-border"
            )}
          />
          {step.label}
        </li>
      ))}
    </ol>
  );
}
