import type { KanbanCardRow } from "~/server/db/types";

type CardOnshapeFields = Pick<
  KanbanCardRow,
  | "onshape_document_id"
  | "onshape_instance_type"
  | "onshape_instance_id"
  | "onshape_element_id"
  | "onshape_version_id"
>;

/**
 * The Onshape page for a card's Part Studio, or null when the card wasn't
 * released from Onshape. Prefers the released version, so the link shows the
 * part as it was released rather than as it is now.
 */
export function cardOnshapeUrl(card: CardOnshapeFields): string | null {
  const {
    onshape_document_id: documentId,
    onshape_instance_type: instanceType,
    onshape_instance_id: instanceId,
    onshape_element_id: elementId,
  } = card;
  if (!documentId || !instanceType || !instanceId || !elementId) return null;
  const versionId =
    card.onshape_version_id || (instanceType === "v" ? instanceId : null);
  const [wvm, id] = versionId
    ? ["v", versionId]
    : [instanceType === "w" ? "w" : "m", instanceId];
  return `https://cad.onshape.com/documents/${documentId}/${wvm}/${id}/e/${elementId}`;
}
