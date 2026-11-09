import type { ReleaseIssue } from "~/onshape_connector/utils/partEligibility";

export function ReleaseIssues({ issues }: { issues: ReleaseIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul aria-label="Release checks" className="space-y-2 text-sm">
      {issues.map((issue) => (
        <li key={issue.code} className="border-border border-l-4 pl-3">
          <span
            className={
              issue.severity === "error"
                ? "text-destructive font-semibold"
                : "font-semibold"
            }
          >
            {issue.severity === "error" ? "Error" : "Warning"}
          </span>
          <p>{issue.message}</p>
          {issue.fix && <p className="text-muted-foreground">{issue.fix}</p>}
        </li>
      ))}
    </ul>
  );
}
