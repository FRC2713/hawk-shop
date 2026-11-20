import { useMemo, useState } from "react";
import { Search, TriangleAlert, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { kanbanCardsQuery, type KanbanCardWithProcesses } from "~/lib/api";
import { cardMachineName, unlinkedMachineText } from "~/lib/cardMachine";
import { plural } from "~/lib/phoneParts";
import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { partHref } from "~/lib/phone";
import { cn } from "~/lib/utils";
import { AssignSheet } from "./AssignSheet";
import { loadState } from "./LoadState";
import { PartList } from "./PartRow";

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

/** What an empty list says under each filter; under "No machine" it's good news. */
const EMPTY: Record<Filter, string> = {
  "no-machine": "Every backlog part has a machine.",
  warnings: "No release warnings.",
  all: "The backlog is empty.",
};

const NO_PROCESS = "No process";

/**
 * Desktop columns: title, material, quantity, machine, warnings. The first
 * group heading uses the same template so its column labels line up. The
 * quantity cell keeps its own right padding so "×6" never runs into the
 * machine name beside it.
 */
const COLUMNS =
  "lg:grid lg:grid-cols-[minmax(0,1fr)_14rem_4rem_14rem_7.5rem] lg:items-center lg:gap-x-6";

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

function partDetail(card: KanbanCardWithProcesses) {
  const issues = card.release_issues?.length ?? 0;
  return [
    card.onshape_material || null,
    card.quantity_to_make ? `×${card.quantity_to_make}` : null,
    cardMachineName(card) ?? unlinkedMachineText(card) ?? "No machine",
    issues ? plural(issues, "warning") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * One backlog part: a 44 px selection target down the left edge, then the
 * part link. Phone shows one detail line under the title; desktop spreads the
 * detail into columns so quantity and machine can be scanned down the list.
 */
function BacklogRow({
  card,
  selected,
  onToggle,
}: {
  card: KanbanCardWithProcesses;
  selected: boolean;
  onToggle: (on: boolean) => void;
}) {
  const machine = cardMachineName(card) ?? unlinkedMachineText(card);
  const issues = card.release_issues?.length ?? 0;
  return (
    <li
      className={cn(
        "flex min-h-11 items-stretch pr-3 transition-colors not-last:border-b",
        selected ? "bg-muted/60" : "hover:bg-muted/60"
      )}
    >
      {/* The whole left gutter toggles, so a near miss doesn't open the part. */}
      <label className="flex min-h-11 w-12 shrink-0 cursor-pointer items-center justify-center">
        <Checkbox
          aria-label={`Select ${card.title}`}
          checked={selected}
          onCheckedChange={(on) => onToggle(on === true)}
          className="size-5"
        />
      </label>
      <a
        href={partHref(card.id)}
        className={cn(
          "text-foreground flex min-h-11 min-w-0 flex-1 flex-col justify-center py-2 no-underline",
          COLUMNS
        )}
      >
        <span className="min-w-0 font-semibold break-words">{card.title}</span>
        <span className="text-muted-foreground text-xs lg:hidden">
          {partDetail(card)}
        </span>
        <span className="text-muted-foreground hidden truncate text-sm lg:block">
          {card.onshape_material || "—"}
        </span>
        <span className="brand-figures hidden pr-2 text-right text-sm lg:block">
          {card.quantity_to_make ? `×${card.quantity_to_make}` : "—"}
        </span>
        <span
          className={cn(
            "hidden truncate text-sm lg:block",
            !machine && "text-muted-foreground italic"
          )}
        >
          {machine ?? "No machine"}
        </span>
        <span className="hidden text-sm lg:block">
          {issues > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <TriangleAlert
                className="text-icon-accent size-4 shrink-0"
                aria-hidden="true"
              />
              {plural(issues, "warning")}
            </span>
          )}
        </span>
      </a>
    </li>
  );
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
            enterKeyHint="search"
            placeholder="Part name"
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-h-11 [&::-webkit-search-cancel-button]:appearance-none"
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
              {label}
              {/* No count until the backlog loads, so it never reads 0. */}
              {cardsQuery.data && (
                <>
                  {" "}
                  <span className="brand-figures">
                    {backlog.filter(matchesFilter[id]).length}
                  </span>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {cardsQuery.data && selected.length === 0 && groups.length > 0 && (
        <p className="text-muted-foreground text-sm">
          Tick parts, then assign them to a machine.
        </p>
      )}

      {loadState([cardsQuery], "Loading backlog...")}
      {cardsQuery.data && groups.length === 0 && (
        <p
          className={cn(
            "bg-card rounded-xl border p-4 text-sm",
            !term && filter !== "all" && "border-l-status-active border-l-4"
          )}
        >
          {term
            ? `No backlog part matches “${search?.trim()}”.`
            : EMPTY[filter]}
        </p>
      )}

      {groups.map(([name, groupCards], index) => (
        <section key={name} className="space-y-2 pt-1">
          <div
            className={cn("flex items-baseline", COLUMNS, "lg:pr-3 lg:pl-12")}
          >
            <h2 className="section-title">
              {name}{" "}
              <span className="text-muted-foreground brand-figures font-normal">
                {groupCards.length}
              </span>
            </h2>
            {/* Column labels once, over the first group only. */}
            {index === 0 && (
              <>
                <span aria-hidden="true" className="eyebrow hidden lg:block">
                  Material
                </span>
                <span
                  aria-hidden="true"
                  className="eyebrow hidden pr-2 text-right lg:block"
                >
                  Qty
                </span>
                <span aria-hidden="true" className="eyebrow hidden lg:block">
                  Machine
                </span>
              </>
            )}
          </div>
          <PartList label={name}>
            {groupCards.map((card) => (
              <BacklogRow
                key={card.id}
                card={card}
                selected={selectedIds.has(card.id)}
                onToggle={(on) => toggle(card.id, on)}
              />
            ))}
          </PartList>
        </section>
      ))}

      {selected.length > 0 && (
        <div className="bg-background sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] -mx-5 flex items-center gap-3 border-t px-5 py-2 lg:bottom-4 lg:mx-0 lg:rounded-xl lg:border lg:px-3 lg:shadow-lg">
          <Button
            variant="ghost"
            className="min-h-11"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </Button>
          <Button
            className="min-h-11 flex-1 lg:ml-auto lg:flex-none lg:px-6"
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
