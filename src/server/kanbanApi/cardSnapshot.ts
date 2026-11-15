import "virtual:hawk-shop/server-only";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/client";
import { kanbanCards } from "~/server/db/schema";
import { publishKanbanEvent } from "~/server/events/bus";
import {
  MATERIAL_UNKNOWN,
  needsOnshapeSnapshot,
  snapshotVersionId,
  type CardSnapshot,
} from "~/lib/cardSnapshot";
import { partStudioFreshness } from "~/lib/onshapeApi/partStudioFreshness";
import { findPart } from "~/onshape_connector/utils/findPart";
import { fetchVersionFromOnshape } from "~/onshape_connector/utils/versionQuery.server";

/**
 * The material a card records: Onshape's display name, or an empty string when
 * Onshape had none set. Null is reserved for "never captured".
 */
export function materialSnapshot(part: {
  material?: { displayName?: string | null } | null;
}): string {
  return part.material?.displayName ?? "";
}

/**
 * A version's name, read through the cached version path: `""` when it has
 * none. Throws when Onshape cannot answer.
 */
async function versionName(
  documentId: string,
  versionId: string
): Promise<string> {
  return (await fetchVersionFromOnshape(documentId, versionId)).name ?? "";
}

/**
 * The version name a card records. Null when Onshape could not answer; the
 * card is backfilled later instead of failing the caller.
 */
export async function versionNameSnapshot(
  documentId: string,
  versionId: string
): Promise<string | null> {
  try {
    return await versionName(documentId, versionId);
  } catch (error) {
    console.error("[CARD SNAPSHOT] Version read failed:", error);
    return null;
  }
}

/**
 * Fill the Onshape snapshot of a card released before snapshots existed, and
 * return it. One cached parts read and one cached version read at most; a card
 * that already has its snapshot costs nothing. A part that has left its Part
 * Studio is a permanent answer, saved with `MATERIAL_UNKNOWN`. When Onshape
 * cannot answer, the card is left unsaved (a later open tries again) and
 * unknown values return.
 *
 * Throws `Error("Card not found")` for an unknown id.
 */
export async function backfillCardSnapshot(
  cardId: string
): Promise<CardSnapshot> {
  const card = db
    .select()
    .from(kanbanCards)
    .where(eq(kanbanCards.id, cardId))
    .get();
  if (!card) throw new Error("Card not found");
  const current = {
    onshape_material: card.onshape_material,
    onshape_version_name: card.onshape_version_name,
  };
  if (!needsOnshapeSnapshot(card)) return current;

  const versionId = snapshotVersionId(card);
  let snapshot: CardSnapshot;
  try {
    // Read through Part Studio freshness directly, not the connector's parts
    // query: opening an old card must not register a webhook for its document.
    // The version read is `versionName`, not `versionNameSnapshot`: that
    // swallows a failure so a release never fails over a name. Here a failed
    // read must throw, so the catch below saves nothing and answers unknown,
    // and a later open tries again.
    const [parts, name] = await Promise.all([
      partStudioFreshness.get({
        documentId: card.onshape_document_id!,
        instanceType: card.onshape_instance_type!,
        instanceId: card.onshape_instance_id!,
        elementId: card.onshape_element_id!,
      }),
      versionId ? versionName(card.onshape_document_id!, versionId) : null,
    ]);
    const title = card.title.trim().toLowerCase();
    const part =
      findPart(parts, card.onshape_part_id) ??
      parts.find((part) => part.partNumber?.trim().toLowerCase() === title);
    snapshot = {
      onshape_material: part ? materialSnapshot(part) : MATERIAL_UNKNOWN,
      onshape_version_name: name,
    };
  } catch (error) {
    console.error("[CARD SNAPSHOT] Backfill failed:", error);
    return UNKNOWN;
  }

  db.update(kanbanCards).set(snapshot).where(eq(kanbanCards.id, cardId)).run();
  publishKanbanEvent({ table: "kanban_cards", action: "update", id: cardId });
  return snapshot;
}

const UNKNOWN: CardSnapshot = {
  onshape_material: null,
  onshape_version_name: null,
};
