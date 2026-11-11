import { NOT_A_VERSION_ISSUE } from "~/onshape_connector/utils/partEligibility";

/** Connector banner shown when the Part Studio is open in a workspace or history entry, not a version. */
export function VersionRequiredNotice({
  instanceType,
}: {
  instanceType: string;
}) {
  const where = instanceType === "m" ? "a history entry" : "a workspace";
  return (
    <div
      role="status"
      className="bg-muted flex flex-col gap-0.5 rounded-r-lg border-l-4 border-[var(--primary)] px-3.5 py-3"
    >
      <p className="font-heading font-semibold">
        <span className="text-[var(--emphasis)]">Release is turned off.</span>{" "}
        You're viewing {where}, which may still change.
      </p>
      <p className="text-muted-foreground text-sm">
        {NOT_A_VERSION_ISSUE.message} {NOT_A_VERSION_ISSUE.fix}
        {instanceType === "w" &&
          " You can still set part numbers here before you create the version."}
      </p>
    </div>
  );
}
