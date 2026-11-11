import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";
import type { KanbanCardRow } from "~/server/db/types";

export interface ReleaseIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
  fix?: string;
}

export interface ReleaseCheckContext {
  matchingCard?: Pick<KanbanCardRow, "id">;
  quantityPerRobot?: number | "";
  quantityToMake?: number | "";
  instanceType?: string;
  /** Override the default placeholder names, matched case-insensitively. */
  placeholderMaterials?: readonly string[];
}

/**
 * Parts are released only from an Onshape version. A workspace may still be
 * changing, so the shop could build a part that no longer matches the design.
 */
export const NOT_A_VERSION_ISSUE: ReleaseIssue = {
  code: "not-a-version",
  severity: "error",
  message: "Parts can only be released from an Onshape version.",
  fix: "In Onshape, open a version of this Part Studio (or create one), then release from there.",
};

export function isVersionInstance(instanceType: string | undefined): boolean {
  return instanceType === "v";
}

export function checkPartForRelease(
  part: BtPartMetadataInfo | undefined,
  context: ReleaseCheckContext = {}
): ReleaseIssue[] {
  return releaseRules.flatMap((rule) => rule(part, context) ?? []);
}

type ReleaseRule = (
  part: BtPartMetadataInfo | undefined,
  context: ReleaseCheckContext
) => ReleaseIssue | undefined;

const releaseRules: ReleaseRule[] = [
  (_, context) =>
    context.instanceType !== undefined &&
    !isVersionInstance(context.instanceType)
      ? NOT_A_VERSION_ISSUE
      : undefined,

  (part) =>
    !part?.description?.trim()
      ? {
          code: "missing-description",
          severity: "warning",
          message: "This part has no description.",
          fix: "Add a description in Onshape so the shop knows what it is.",
        }
      : undefined,

  (_, context) =>
    typeof context.quantityPerRobot === "number" &&
    typeof context.quantityToMake === "number" &&
    context.quantityToMake < context.quantityPerRobot
      ? {
          code: "quantity-below-per-robot",
          severity: "warning",
          message: "Quantity to make is below quantity per robot.",
          fix: "Check the requested quantities, including any parts already in stock.",
        }
      : undefined,

  (part, context) =>
    part?.material?.displayName &&
    (context.placeholderMaterials ?? ["Unknown", "Default", "Generic"]).some(
      (name) =>
        name.trim().toLowerCase() ===
        part.material!.displayName!.trim().toLowerCase()
    )
      ? {
          code: "placeholder-material",
          severity: "warning",
          message: "This part uses a placeholder material.",
          fix: "Choose the stock material in Onshape before manufacturing.",
        }
      : undefined,

  (part) =>
    !part?.material?.displayName
      ? {
          code: "missing-material",
          severity: "error",
          message: "This part has no material.",
          fix: "Set the material in Onshape.",
        }
      : undefined,
  (part) =>
    !part?.partNumber
      ? {
          code: "missing-part-number",
          severity: "error",
          message: "This part has no part number.",
          fix: "Set the part number in Onshape.",
        }
      : undefined,
  (_, context) =>
    context.matchingCard
      ? {
          code: "already-on-board",
          severity: "error",
          message: "This part is already in the manufacturing tracker.",
          fix: "Use the existing card for this part and version.",
        }
      : undefined,
];

export function isPartEligibleForRelease(
  part: BtPartMetadataInfo | undefined,
  matchingCard: ReleaseCheckContext["matchingCard"],
  instanceType?: string
): boolean {
  return !checkPartForRelease(part, { matchingCard, instanceType }).some(
    (issue) => issue.severity === "error"
  );
}
