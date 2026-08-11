"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { KanbanCard } from "~/components/mfg/kanban/cards/KanbanCard";
import {
  useKanbanCards,
  useKanbanConfig,
  useUsers,
} from "~/lib/kanbanApi/queries";
import type { KanbanCardRow } from "~/lib/db/types";

export function DoneClient() {
  const router = useRouter();
  const { data: config } = useKanbanConfig();
  const { data: cardsData, isLoading: isLoadingCards } = useKanbanCards();
  const { data: users = [] } = useUsers();

  // Get the last column ID (Done column)
  const doneColumnId = useMemo(() => {
    if (!config || config.columns.length === 0) return null;
    const lastColumn = config.columns[config.columns.length - 1];
    return lastColumn.id;
  }, [config]);

  // Filter cards for the Done column
  const doneCards = useMemo(() => {
    if (!cardsData?.cards || !doneColumnId) return [];
    return cardsData.cards.filter((card) => card.column_id === doneColumnId);
  }, [cardsData, doneColumnId]);

  // Create user lookup map
  const usersMap = useMemo(() => {
    const map = new Map<string, (typeof users)[0]>();
    users.forEach((user) => {
      map.set(user.onshape_user_id, user);
    });
    return map;
  }, [users]);

  // Sort cards by date_updated (newest first)
  const sortedCards = useMemo(() => {
    return [...doneCards].sort((a, b) => {
      const dateA = new Date(a.date_updated).getTime();
      const dateB = new Date(b.date_updated).getTime();
      return dateB - dateA;
    });
  }, [doneCards]);

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
                onClick={() => router.push("/kanban")}
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
              <h3 className="mb-2 text-lg font-semibold">No completed cards</h3>
              <p className="text-muted-foreground text-sm">
                Cards that have been in the Done column for more than 24 hours
                will appear here.
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sortedCards.map((card) => (
              <div key={card.id} className="w-full">
                <KanbanCard
                  card={card as KanbanCardRow & { processes?: any[] }}
                  usersMap={usersMap}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
