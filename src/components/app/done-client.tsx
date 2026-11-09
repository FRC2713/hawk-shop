import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Search, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { KanbanCard } from "~/components/mfg/kanban/cards/KanbanCard";
import { useQuery } from "@tanstack/react-query";
import { kanbanCardsQuery, kanbanConfigQuery, usersQuery } from "~/lib/api";
import { Input } from "~/components/ui/input";
import { buildSearchIndex } from "~/lib/search";

export function DoneClient() {
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const restoreSearch = () =>
      setSearchQuery(new URL(window.location.href).searchParams.get("q") || "");
    restoreSearch();
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key !== "/" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (target instanceof HTMLElement &&
          (target.closest("input, textarea, select, [role='textbox']") ||
            target.isContentEditable))
      )
        return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("popstate", restoreSearch);
    window.addEventListener("keydown", focusSearch);
    return () => {
      window.removeEventListener("popstate", restoreSearch);
      window.removeEventListener("keydown", focusSearch);
    };
  }, []);

  const changeSearch = (query: string) => {
    setSearchQuery(query);
    const url = new URL(window.location.href);
    if (query) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    window.history.replaceState(window.history.state, "", url);
  };
  const { data: config } = useQuery(kanbanConfigQuery());
  const { data: cards = [], isLoading: isLoadingCards } =
    useQuery(kanbanCardsQuery());
  const { data: users = [] } = useQuery(usersQuery());

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
  const usersMap = useMemo(() => {
    const map = new Map<string, (typeof users)[0]>();
    users.forEach((user) => {
      map.set(user.onshape_user_id, user);
    });
    return map;
  }, [users]);

  const searchIndex = useMemo(
    () =>
      buildSearchIndex(doneCards, [
        { value: (card) => card.title, weight: 2 },
        { value: (card) => card.content, weight: 2 },
        {
          value: (card) =>
            card.assignee
              ? usersMap.get(card.assignee)?.name || card.assignee
              : null,
        },
        {
          value: (card) =>
            card.created_by
              ? usersMap.get(card.created_by)?.name || card.created_by
              : null,
        },
        { value: (card) => card.machine },
        {
          value: (card) =>
            card.processes?.map((process) => process.name).join(" "),
        },
      ]),
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
      .filter((card) => searchScores.has(card.id))
      .sort((a, b) => {
        const dateA = new Date(a.date_updated).getTime();
        const dateB = new Date(b.date_updated).getTime();
        return dateB - dateA;
      });
  }, [doneCards, searchScores]);

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
                  Done Cards
                </h1>
                <p className="text-muted-foreground mt-1 text-sm">
                  {isLoadingCards
                    ? "Loading..."
                    : `${sortedCards.length} completed card${sortedCards.length !== 1 ? "s" : ""}`}
                </p>
              </div>
            </div>
            <div className="relative w-full min-w-0 flex-1 sm:max-w-md">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                ref={searchRef}
                aria-label="Search completed cards"
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
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
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
                {searchQuery.trim()
                  ? "No matching completed cards"
                  : "No completed cards"}
              </h3>
              <p className="text-muted-foreground text-sm">
                {searchQuery.trim()
                  ? "Try another search or clear the search to see all completed cards."
                  : "Cards that have been in the Done column for more than 24 hours will appear here."}
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sortedCards.map((card) => (
              <div key={card.id} className="w-full">
                <KanbanCard card={card} usersMap={usersMap} />
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
