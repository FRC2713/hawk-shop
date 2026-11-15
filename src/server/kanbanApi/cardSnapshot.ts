import "virtual:hawk-shop/server-only";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/client";
import { kanbanCards } from "~/server/db/schema";
import { publishKanbanEvent } from "~/server/events/bus";
import {
  needsOnshapeSnapshot,
  snapshotVersionId,
  type CardSnapshot,
} from "~/lib/cardSnapshot";
import { fetchPartsFromOnshape } from "~/onshape_connector/utils/partsQuery.server";
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
 * The version name a card records, read through the cached version path.
 * Null when Onshape could not answer; the card is backfilled later instead of
 * failing the caller.
 */
export async function versionNameSnapshot(
  documentId: string,
  versionId: string
): Promise<string | null> {
  try {
    return (await fetchVersionFromOnshape(documentId, versionId)).name ?? "";
  } catch (error) {
    console.error("[CARD SNAPSHOT] Version read failed:", error);
    return null;
  }
}

/**
 * Fill the Onshape snapshot of a card released before snapshots existed, and
 * return it. One cached parts read and one cached version read at most; a card
 * that already has its snapshot costs nothing. When Onshape cannot answer, the
 * card is left unsaved (a later open tries again) and unknown values return.
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
    const parts = await fetchPartsFromOnshape({
      documentId: card.onshape_document_id!,
      instanceType: card.onshape_instance_type as "w" | "v" | "m",
      instanceId: card.onshape_instance_id!,
      elementId: card.onshape_element_id!,
      elementType: "PARTSTUDIO",
    });
    const title = card.title.trim().toLowerCase();
    const part =
      parts.find(
        (part) =>
          !!card.onshape_part_id &&
          (part.partId || part.id) === card.onshape_part_id
      ) ??
      parts.find((part) => part.partNumber?.trim().toLowerCase() === title);
    // A part that has left its Part Studio has no material to record.
    if (!part) return UNKNOWN;
    snapshot = {
      onshape_material: materialSnapshot(part),
      onshape_version_name: versionId
        ? ((await fetchVersionFromOnshape(card.onshape_document_id!, versionId))
            .name ?? "")
        : null,
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
