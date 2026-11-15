/**
 * Client-safe rules for the Onshape facts a card records at release
 * (`onshape_material`, `onshape_version_name`).
 */
export interface CardSnapshotFields {
  onshape_document_id: string | null;
  onshape_instance_type: string | null;
  onshape_instance_id: string | null;
  onshape_element_id: string | null;
  onshape_version_id: string | null;
  onshape_material: string | null;
  onshape_version_name: string | null;
}

export interface CardSnapshot {
  onshape_material: string | null;
  onshape_version_name: string | null;
}

/**
 * The material recorded for a card whose part has left its Part Studio. That
 * answer is permanent, so it is saved (later opens cost nothing) and reads as
 * "Unknown", like Onshape's own placeholder material of the same name.
 */
export const MATERIAL_UNKNOWN = "Unknown";

/**
 * The Onshape version a card was released from, or null. Older workspace cards
 * stored their workspace id as `onshape_version_id`; that names no version.
 */
export function snapshotVersionId(card: CardSnapshotFields): string | null {
  if (card.onshape_instance_type !== "v") return null;
  return card.onshape_version_id || card.onshape_instance_id || null;
}

/** Whether the card is missing facts a one-time backfill can capture. */
export function needsOnshapeSnapshot(card: CardSnapshotFields): boolean {
  if (
    !card.onshape_document_id ||
    !card.onshape_instance_type ||
    !card.onshape_instance_id ||
    !card.onshape_element_id
  )
    return false;
  if (card.onshape_material === null) return true;
  return !!snapshotVersionId(card) && card.onshape_version_name === null;
}
