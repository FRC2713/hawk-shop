import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { kanbanCardsQuery, type KanbanCardWithProcesses } from "~/lib/api";
import { cardMachineName, unlinkedMachineText } from "~/lib/cardMachine";
import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";
import { ErrorMessage } from "~/components/mfg/ErrorDisplay";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import { AssignSheet } from "./AssignSheet";
import { PartList, PartRow } from "./PartRow";

type Filter = "no-machine" | "warnings" | "all";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "no-machine", label: "No machine" },
  { id: "warnings", label: "Warnings" },
  { id: "all", label: "All" },
];

const matchesFilter: Record<
  Filter,
  (card: KanbanCardWithProcesses) => boolean
> = {
  "no-machine": (card) => !card.machine_id,
  warnings: (card) => (card.release_issues?.length ?? 0) > 0,
  all: () => true,
};

const NO_PROCESS = "No process";

/**
 * The group a backlog part sits in: its process, or the first by name when it
 * has several.
 */
function groupName(card: KanbanCardWithProcesses) {
  const names = (card.processes ?? []).map((process) => process.name).sort();
  return names[0] ?? NO_PROCESS;
}

function byGroupName(a: string, b: string) {
  if (a === NO_PROCESS) return b === NO_PROCESS ? 0 : 1;
  if (b === NO_PROCESS) return -1;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/** Oldest release first, then by name. */
function byAge(a: KanbanCardWithProcesses, b: KanbanCardWithProcesses) {
  return (
    a.date_created.localeCompare(b.date_created) ||
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
  );
}

function groupByProcess(cards: KanbanCardWithProcesses[]) {
  const byName = new Map<string, KanbanCardWithProcesses[]>();
  for (const card of cards) {
    const name = groupName(card);
    byName.set(name, [...(byName.get(name) ?? []), card]);
  }
  return [...byName].sort(([a], [b]) => byGroupName(a, b));
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function partDetail(card: KanbanCardWithProcesses) {
  const issues = card.release_issues?.length ?? 0;
  return [
    card.onshape_material || null,
    card.quantity_to_make ? `×${card.quantity_to_make}` : null,
    cardMachineName(card) ?? unlinkedMachineText(card),
    issues ? plural(issues, "warning") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The phone Backlog tab, for a shop mentor routing waiting parts: parts
 * grouped by process and filtered to those with no machine by default.
 */
export function BacklogTab() {
  const cardsQuery = useQuery(kanbanCardsQuery());
  const [filter, setFilter] = useState<Filter>("no-machine");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [assigning, setAssigning] = useState(false);
  // Null while the search box is closed.
  const [search, setSearch] = useState<string | null>(null);

  const backlog = useMemo(
    () =>
      (cardsQuery.data ?? [])
        .filter((card) => card.column_id === WORKFLOW_COLUMN_IDS.backlog)
        .sort(byAge),
    [cardsQuery.data]
  );
  // A search looks through the whole backlog, whatever the filter.
  const term = search?.trim().toLocaleLowerCase();
  const shown = term
    ? backlog.filter((card) => card.title.toLocaleLowerCase().includes(term))
    : backlog.filter(matchesFilter[filter]);
  const groups = groupByProcess(shown);
  const noMachine = backlog.filter(matchesFilter["no-machine"]).length;
  // Parts that left the backlog since they were ticked drop out.
  const selected = backlog.filter((card) => selectedIds.has(card.id));
  const toggle = (id: string, on: boolean) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <main className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl">Backlog</h1>
          {cardsQuery.data && (
            <p className="text-muted-foreground text-sm">
              {plural(backlog.length, "part")} · {noMachine} with no machine
            </p>
          )}
        </div>
        {search === null && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Search parts"
            className="size-11"
            onClick={() => setSearch("")}
          >
            <Search className="size-5" aria-hidden="true" />
          </Button>
        )}
      </div>

      {search !== null ? (
        <div className="flex items-center gap-2">
          <Input
            type="search"
            aria-label="Search parts"
            placeholder="Part name"
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-h-11"
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close search"
            className="size-11"
            onClick={() => setSearch(null)}
          >
            <X className="size-5" aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={cn(
                "min-h-11 rounded-full border px-3 text-sm font-semibold",
                filter === id
                  ? "bg-primary border-primary text-primary-foreground"
                  : "bg-card text-foreground"
              )}
            >
              {label}{" "}
              <span className="brand-figures">
                {backlog.filter(matchesFilter[id]).length}
              </span>
            </button>
          ))}
        </div>
      )}

      {cardsQuery.isPending && (
        <p role="status" className="text-muted-foreground">
          Loading backlog...
        </p>
      )}
      {cardsQuery.isError && (
        <div className="space-y-2">
          <ErrorMessage error={cardsQuery.error} />
          <Button variant="outline" onClick={() => cardsQuery.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {cardsQuery.data && groups.length === 0 && (
        <p className="text-muted-foreground bg-muted rounded-lg p-4 text-sm">
          {term
            ? `No backlog part matches “${search?.trim()}”.`
            : "Nothing to show here."}
        </p>
      )}

      {groups.map(([name, groupCards]) => (
        <section key={name} className="space-y-2">
          <h2 className="text-muted-foreground text-base font-semibold">
            {name} · <span className="brand-figures">{groupCards.length}</span>
          </h2>
          <PartList label={name}>
            {groupCards.map((card) => (
              <PartRow
                key={card.id}
                card={card}
                detail={partDetail(card)}
                leading={
                  <Checkbox
                    aria-label={`Select ${card.title}`}
                    checked={selectedIds.has(card.id)}
                    onCheckedChange={(on) => toggle(card.id, on === true)}
                    className="size-5"
                  />
                }
              />
            ))}
          </PartList>
        </section>
      ))}

      {selected.length > 0 && (
        <div className="bg-background sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] -mx-5 flex items-center gap-3 border-t px-5 py-2 lg:bottom-0">
          <Button
            variant="ghost"
            className="min-h-11"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </Button>
          <Button
            className="min-h-11 flex-1"
            onClick={() => setAssigning(true)}
          >
            Assign {plural(selected.length, "part")}
          </Button>
        </div>
      )}
      <AssignSheet
        cards={selected}
        open={assigning && selected.length > 0}
        onOpenChange={setAssigning}
        onAssigned={() => {
          setAssigning(false);
          setSelectedIds(new Set());
        }}
      />
    </main>
  );
}
