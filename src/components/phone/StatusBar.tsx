import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";
import { cn } from "~/lib/utils";

/** The four workflow steps, in order, with the labels the phone pages use. */
export const WORKFLOW_STEPS = [
  { id: WORKFLOW_COLUMN_IDS.backlog, label: "Backlog" },
  { id: WORKFLOW_COLUMN_IDS.inProgress, label: "In progress" },
  { id: WORKFLOW_COLUMN_IDS.review, label: "Review" },
  { id: WORKFLOW_COLUMN_IDS.done, label: "Done" },
];

/** The step label for a column, or `fallback` for a column outside the workflow. */
export function stepLabel(
  columnId: string | null | undefined,
  fallback: string
): string {
  return WORKFLOW_STEPS.find((step) => step.id === columnId)?.label ?? fallback;
}

/**
 * A part's status as four steps. Past steps are a softer red, the current
 * step is thicker and full red (`aria-current="step"`), and a Done part fills
 * every step teal. A card in a column outside the workflow fills nothing.
 */
export function StatusBar({
  columnId,
  className,
}: {
  columnId: string;
  className?: string;
}) {
  const current = WORKFLOW_STEPS.findIndex((step) => step.id === columnId);
  const done = current === WORKFLOW_STEPS.length - 1;
  return (
    <ol
      aria-label="Status"
      className={cn("grid grid-cols-4 items-start gap-1", className)}
    >
      {WORKFLOW_STEPS.map((step, index) => (
        <li
          key={step.id}
          aria-current={index === current ? "step" : undefined}
          className={cn(
            "flex flex-col gap-1.5",
            index === current
              ? "text-foreground text-sm/5 font-bold"
              : "text-muted-foreground text-xs/5"
          )}
        >
          <span aria-hidden="true" className="flex h-1.5 items-end">
            <span
              className={cn(
                "w-full rounded-sm",
                index === current ? "h-1.5" : "h-1",
                done
                  ? "bg-status-active"
                  : index === current
                    ? "bg-primary"
                    : index < current
                      ? "bg-primary/70"
                      : "bg-border"
              )}
            />
          </span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}
