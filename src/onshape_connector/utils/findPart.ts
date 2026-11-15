import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";

/** The part with this id (`partId`, or `id` when Onshape sent no `partId`). */
export function findPart(
  parts: BtPartMetadataInfo[],
  partId: string | null | undefined
): BtPartMetadataInfo | undefined {
  if (!partId) return undefined;
  return parts.find((part) => (part.partId || part.id) === partId);
}
