import { useUrlSearch } from "~/hooks/useUrlSearch";
import { useUrlProjectView } from "~/hooks/useUrlProjectView";
import { useMinuteClock } from "~/hooks/useMinuteClock";
import { ProjectFilter } from "~/components/mfg/ProjectFilter";
import { useMemo } from "react";
import { ArrowLeft, CheckCircle2, Search, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { KanbanCard } from "~/components/mfg/kanban/cards/KanbanCard";
import { useQuery } from "@tanstack/react-query";
import { kanbanCardsQuery, kanbanConfigQuery, usersQuery } from "~/lib/api";
import { Input } from "~/components/ui/input";
import { buildCardSearchIndex, buildCardUsersMap } from "~/lib/card-search";
import { plural } from "~/lib/plural";
import type { KanbanCardWithProcesses } from "~/lib/api/kanban";

const DAY = 24 * 60 * 60 * 1000;

/** "Today", "Yesterday", a weekday within the week, else "Nov 10". */
function dayHeading(date: Date, now: Date) {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const daysAgo = Math.round((midnight.getTime() - day.getTime()) / DAY);
  if (daysAgo <= 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo < 7) return date.toLocaleDateString("en-US", { weekday: "long" });
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** Consecutive cards (already newest first) grouped under day headings. */
function groupByDay(cards: KanbanCardWithProcesses[], now: number) {
  const groups: { heading: string; cards: KanbanCardWithProcesses[] }[] = [];
  for (const card of cards) {
    const date = new Date(card.date_updated);
    const heading = isNaN(date.getTime())
      ? "Unknown date"
      : dayHeading(date, new Date(now));
    const last = groups[groups.length - 1];
    if (last?.heading === heading) last.cards.push(card);
    else groups.push({ heading, cards: [card] });
  }
  return groups;
}

export function DoneClient() {
  const { searchQuery, changeSearch, searchRef } = useUrlSearch();
  const { projectIds, setProjectIds } = useUrlProjectView();
  const { data: config } = useQuery(kanbanConfigQuery());
  const { data: cards = [], isLoading: isLoadingCards } =
    useQuery(kanbanCardsQuery());
  const { data: users = [] } = useQuery(usersQuery());
  const now = useMinuteClock();

  // Get the last column ID (Done column)
  const doneColumnId = useMemo(() => {
    if (!config || config.columns.length === 0) return null;
    const lastColumn = config.columns[config.columns.length - 1];
    return lastColumn.id;
  }, [config]);

  // Filter cards for the Done column
  const doneCards = useMemo(() => {
    if (!doneColumnId) return [];
    return cards.filter((card) => card.column_id === doneColumnId);
  }, [cards, doneColumnId]);

  // Create user lookup map
  const usersMap = useMemo(() => buildCardUsersMap(users), [users]);

  const searchIndex = useMemo(
    () => buildCardSearchIndex(doneCards, usersMap),
    [doneCards, usersMap]
  );

  const searchScores = useMemo(
    () =>
      new Map(
        searchIndex.search(searchQuery).map(({ id, score }) => [id, score])
      ),
    [searchIndex, searchQuery]
  );

  // Keep the completed-card order within the search results.
  // Sort cards by date_updated (newest first)
  const sortedCards = useMemo(() => {
    return doneCards
      .filter(
        (card) =>
          searchScores.has(card.id) &&
          (projectIds.length === 0 || projectIds.includes(card.project_id))
      )
      .sort((a, b) => {
        const dateA = new Date(a.date_updated).getTime();
        const dateB = new Date(b.date_updated).getTime();
        return dateB - dateA;
      });
  }, [doneCards, searchScores, projectIds]);
  const narrowed = searchQuery.trim() !== "" || projectIds.length > 0;
  const dayGroups = useMemo(
    () => groupByDay(sortedCards, now),
    [sortedCards, now]
  );

  return (
    <main className="bg-background flex h-full flex-1 flex-col overflow-hidden">
      {/* Page Header */}
      <header className="bg-muted/30 relative border-b bg-linear-to-r">
        <div className="relative px-4 py-2">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3 sm:gap-4">
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                onClick={() => window.location.assign("/kanban")}
                aria-label="Back to kanban board"
              >
                <ArrowLeft className="size-5" />
              </Button>
              <div className="bg-primary/10 ring-primary/20 flex size-6 shrink-0 items-center justify-center rounded-xl ring-1 sm:size-8">
                <CheckCircle2 className="text-primary size-5 sm:size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
                  Done parts
                </h1>
                <p className="text-muted-foreground mt-1 text-sm">
                  {isLoadingCards
                    ? "Loading..."
                    : `${plural(sortedCards.length, "done part")}, newest first`}
                </p>
              </div>
            </div>
            <div className="flex w-full min-w-0 flex-1 items-center gap-2 sm:max-w-xl">
              <ProjectFilter
                selectedIds={projectIds}
                onChange={setProjectIds}
              />
              <div className="relative w-full min-w-0 flex-1">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input
                  ref={searchRef}
                  aria-label="Search done parts"
                  aria-keyshortcuts="/"
                  type="text"
                  placeholder="Search by part number or name..."
                  value={searchQuery}
                  onChange={(e) => changeSearch(e.target.value)}
                  className="h-9 pr-9 pl-9"
                />
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-1/2 right-0 size-8 -translate-y-1/2"
                    onClick={() => changeSearch("")}
                    title="Clear search"
                    aria-label="Clear search"
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoadingCards ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-muted-foreground">Loading cards...</p>
            </div>
          </div>
        ) : sortedCards.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <CheckCircle2 className="text-muted-foreground mx-auto mb-4 size-12" />
              <h3 className="mb-2 text-lg font-semibold">
                {narrowed ? "No matching done parts" : "No done parts yet"}
              </h3>
              <p className="text-muted-foreground text-sm">
                {narrowed
                  ? "Try another search or project, or clear them to see every done part."
                  : "Parts land here when they reach Done. The board shows only the ones done today."}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {dayGroups.map((group) => (
              <section
                key={group.heading}
                aria-labelledby={`done-${group.heading}`}
                className="space-y-2"
              >
                <h2
                  id={`done-${group.heading}`}
                  className="font-heading flex items-baseline gap-2 text-base font-semibold"
                >
                  {group.heading}
                  <span className="brand-figures text-muted-foreground text-xs font-normal">
                    {group.cards.length}
                  </span>
                </h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {group.cards.map((card) => (
                    <KanbanCard
                      key={card.id}
                      card={card}
                      usersMap={usersMap}
                      now={now}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
