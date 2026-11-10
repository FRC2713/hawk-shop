import type { ReleaseIssue } from "~/onshape_connector/utils/partEligibility";
import { cn } from "~/lib/utils";

/** Release checks as callouts: a red rail for errors, a grey rail for warnings. */
export function ReleaseIssues({ issues }: { issues: ReleaseIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul aria-label="Release checks" className="flex flex-col gap-2 text-sm">
      {issues.map((issue) => {
        const error = issue.severity === "error";
        return (
          <li
            key={issue.code}
            className={cn(
              "bg-muted flex flex-col gap-0.5 rounded-r-lg border-l-4 px-3.5 py-2",
              error
                ? "border-[var(--primary)]"
                : "border-[var(--color-hawk-cool-grey)]"
            )}
          >
            <p className="font-heading font-semibold">
              <span className={cn(error && "text-[var(--emphasis)]")}>
                {error ? "Error" : "Warning"}
              </span>{" "}
              <span>{issue.message}</span>
            </p>
            {issue.fix && (
              <p className="text-muted-foreground text-xs">{issue.fix}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
