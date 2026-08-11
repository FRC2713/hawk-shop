import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";
import type { KanbanCardRow } from "~/lib/db/types";

/**
 * Check if a part is eligible for release to manufacturing
 * A part is eligible if:
 * - It has a material set
 * - It has a part number
 * - It doesn't already have a matching card in the kanban board
 */
export function isPartEligibleForRelease(
  part: BtPartMetadataInfo | undefined,
  matchingCard: KanbanCardRow | undefined
): boolean {
  const hasMaterial = Boolean(part?.material?.displayName);
  const hasPartNumber = Boolean(part?.partNumber);
  const hasNoCard = !matchingCard;
  return hasMaterial && hasPartNumber && hasNoCard;
}
