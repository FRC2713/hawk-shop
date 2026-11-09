import { buildSearchIndex } from "./search";
import type { KanbanCardWithProcesses } from "~/lib/api";
import type { UserRow } from "~/server/db/types";

export function buildCardUsersMap(users: readonly UserRow[]) {
  return new Map(users.map((user) => [user.onshape_user_id, user]));
}

/** Board and Done share fields and identity resolution, while owning their ordering. */
export function buildCardSearchIndex(
  cards: readonly KanbanCardWithProcesses[],
  users: ReadonlyMap<string, UserRow>
) {
  const userName = (id: string | null) =>
    id ? users.get(id)?.name || id : null;
  return buildSearchIndex(cards, [
    { value: (card) => card.title, weight: 2 },
    { value: (card) => card.content, weight: 2 },
    { value: (card) => userName(card.assignee) },
    { value: (card) => userName(card.created_by) },
    { value: (card) => card.machine },
    {
      value: (card) => card.processes?.map((process) => process.name).join(" "),
    },
  ]);
}
