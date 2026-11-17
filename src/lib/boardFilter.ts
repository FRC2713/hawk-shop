import type { KanbanCardWithProcesses } from "~/lib/api";

/** Card order within a column; `relevance` is search score, then load order. */
export type BoardSort = "relevance" | "project" | "user";

/**
 * Everything that narrows or orders the board. It lives in the URL so a view
 * can be bookmarked or shared: `?q=&project=&process=&machine=&submitter=
 * &warnings=1&sort=`. List parameters repeat.
 */
export type BoardFilters = {
  q: string;
  projectIds: string[];
  processIds: string[];
  /** Equipment ids, plus {@link NO_MACHINE} for cards without one. */
  machineIds: string[];
  /** `created_by` user ids. */
  submitterIds: string[];
  warnings: boolean;
  sort: BoardSort;
};

export const NO_MACHINE = "none";

export const EMPTY_BOARD_FILTERS: BoardFilters = {
  q: "",
  projectIds: [],
  processIds: [],
  machineIds: [],
  submitterIds: [],
  warnings: false,
  sort: "relevance",
};

const LIST_PARAMS = {
  projectIds: "project",
  processIds: "process",
  machineIds: "machine",
  submitterIds: "submitter",
} as const;

export function readBoardFilters(params: URLSearchParams): BoardFilters {
  const list = (name: string) =>
    [...new Set(params.getAll(name))].filter(Boolean);
  const sort = params.get("sort");
  return {
    q: params.get("q") || "",
    projectIds: list(LIST_PARAMS.projectIds),
    processIds: list(LIST_PARAMS.processIds),
    machineIds: list(LIST_PARAMS.machineIds),
    submitterIds: list(LIST_PARAMS.submitterIds),
    warnings: params.get("warnings") === "1",
    sort: sort === "project" || sort === "user" ? sort : "relevance",
  };
}

/** Write the filters into `url`, leaving every other parameter alone. */
export function writeBoardFilters(url: URL, filters: BoardFilters) {
  const params = url.searchParams;
  if (filters.q) params.set("q", filters.q);
  else params.delete("q");
  for (const [key, name] of Object.entries(LIST_PARAMS)) {
    params.delete(name);
    for (const id of filters[key as keyof typeof LIST_PARAMS])
      params.append(name, id);
  }
  if (filters.warnings) params.set("warnings", "1");
  else params.delete("warnings");
  if (filters.sort !== "relevance") params.set("sort", filters.sort);
  else params.delete("sort");
}

/** True when any filter narrows the board (sort does not). */
export function hasActiveFilters(filters: BoardFilters) {
  return (
    !!filters.q ||
    filters.warnings ||
    Object.keys(LIST_PARAMS).some(
      (key) => filters[key as keyof typeof LIST_PARAMS].length > 0
    )
  );
}

/**
 * Cards that match every active filter. `searchScores` holds the ids search
 * matched; an empty query matches every card.
 */
export function filterCards<T extends KanbanCardWithProcesses>(
  cards: readonly T[],
  filters: BoardFilters,
  searchScores: ReadonlyMap<string, number>
) {
  const within = (ids: string[], value: string | null | undefined) =>
    ids.length === 0 || (!!value && ids.includes(value));
  return cards.filter(
    (card) =>
      searchScores.has(card.id) &&
      (!filters.warnings || !!card.release_issues?.length) &&
      within(filters.projectIds, card.project_id) &&
      within(filters.submitterIds, card.created_by) &&
      within(filters.machineIds, card.machine_id ?? NO_MACHINE) &&
      (filters.processIds.length === 0 ||
        !!card.processes?.some((process) =>
          filters.processIds.includes(process.id)
        ))
  );
}
