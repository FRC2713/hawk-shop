import type { PartsPageSearchParams } from "./types";

/**
 * Extract version ID from query parameters
 * Returns the version ID based on the instance type:
 * - If instanceType === 'v', returns instanceId (which is the version ID)
 * - If instanceType === 'w', returns instanceId as fallback (workspace ID)
 * - If instanceType === 'm', returns instanceId as fallback (microversion ID)
 *
 * Note: For workspaces and microversions, we use the instanceId as a fallback
 * since we don't have a direct version ID. In practice, cards should be created
 * from version contexts when possible.
 */
export function extractVersionId(queryParams: PartsPageSearchParams): string {
  // If we're viewing a version, the instanceId is the version ID
  if (queryParams.instanceType === "v") {
    return queryParams.instanceId;
  }

  // For workspace or microversion, use instanceId as fallback
  // This allows backward compatibility but ideally cards should be created from versions
  return queryParams.instanceId;
}

/**
 * Generate a composite key for part identification
 * Format: "partNumber::versionId"
 * This uniquely identifies a part by both its part number and document version
 */
export function getPartVersionKey(
  partNumber: string,
  versionId: string
): string {
  return `${partNumber}::${versionId}`;
}

/**
 * Parse a composite key back into part number and version ID
 * Returns null if the key format is invalid
 */
export function parsePartVersionKey(
  key: string
): { partNumber: string; versionId: string } | null {
  const parts = key.split("::");
  if (parts.length !== 2) {
    return null;
  }
  return {
    partNumber: parts[0]!,
    versionId: parts[1]!,
  };
}

/**
 * Get version ID from a kanban card
 * Returns the onshape_version_id if available, otherwise falls back to
 * onshape_instance_id when instance_type is 'v'
 */
export function getCardVersionId(card: {
  onshape_version_id?: string | null;
  onshape_instance_type?: string | null;
  onshape_instance_id?: string | null;
}): string | null {
  // Prefer the dedicated version_id field
  if (card.onshape_version_id) {
    return card.onshape_version_id;
  }

  // Fallback: if instance_type is 'v', use instance_id as version
  if (card.onshape_instance_type === "v" && card.onshape_instance_id) {
    return card.onshape_instance_id;
  }

  return null;
}
