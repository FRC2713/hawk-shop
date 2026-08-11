"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Columns3, Loader2, User, Wrench, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { KanbanColumn as KanbanColumnType } from "~/lib/kanbanApi/columnTypes";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { kanbanQueryKeys } from "~/lib/kanbanApi/queries";
import type { EquipmentRow, KanbanCardRow, UserRow } from "~/lib/db/types";
import { cn } from "~/lib/utils";

async function fetchEquipment() {
  const response = await fetch("/api/equipment");
  if (!response.ok) {
    throw new Error("Failed to fetch equipment");
  }
  const data = await response.json();
  return data.equipment as EquipmentRow[];
}

interface KanbanBulkEditBarProps {
  selectedCardIds: Set<string>;
  cards: KanbanCardRow[];
  columns: KanbanColumnType[];
  users: UserRow[];
  onMoveCard: (cardId: string, columnId: string) => void;
  onClearSelection: () => void;
  isMoving?: boolean;
}

export function KanbanBulkEditBar({
  selectedCardIds,
  cards,
  columns,
  users,
  onMoveCard,
  onClearSelection,
  isMoving = false,
}: KanbanBulkEditBarProps) {
  const queryClient = useQueryClient();
  const [assignPopoverOpen, setAssignPopoverOpen] = useState(false);
  const [machinePopoverOpen, setMachinePopoverOpen] = useState(false);

  const { data: equipment = [] } = useQuery<EquipmentRow[]>({
    queryKey: ["equipment"],
    queryFn: fetchEquipment,
  });

  const sortedEquipment = useMemo(() => {
    return [...equipment].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  }, [equipment]);

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "", undefined, {
        sensitivity: "base",
      })
    );
  }, [users]);

  const selectedCards = useMemo(
    () => cards.filter((c) => selectedCardIds.has(c.id)),
    [cards, selectedCardIds]
  );

  const assignMutation = useMutation({
    mutationFn: async (assignee: string | null) => {
      const results = await Promise.allSettled(
        selectedCards.map((card) =>
          fetch(`/api/kanban/cards/${card.id}/assign`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assignee }),
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        throw new Error(
          `${failed.length} of ${selectedCards.length} cards failed to update`
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: kanbanQueryKeys.cards() });
      setAssignPopoverOpen(false);
      toast.success(
        `Assigned ${selectedCards.length} card${selectedCards.length !== 1 ? "s" : ""}`
      );
    },
    onError: (error) => {
      toast.error("Failed to assign cards", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    },
  });

  const machineMutation = useMutation({
    mutationFn: async (machine: string | null) => {
      const results = await Promise.allSettled(
        selectedCards.map((card) =>
          fetch(`/api/kanban/cards/${card.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ machine }),
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        throw new Error(
          `${failed.length} of ${selectedCards.length} cards failed to update`
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: kanbanQueryKeys.cards() });
      setMachinePopoverOpen(false);
      toast.success(
        `Set machine on ${selectedCards.length} card${selectedCards.length !== 1 ? "s" : ""}`
      );
    },
    onError: (error) => {
      toast.error("Failed to set machine", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    },
  });

  const handleColumnChange = (columnId: string) => {
    selectedCards.forEach((card) => {
      if (card.column_id !== columnId) {
        onMoveCard(card.id, columnId);
      }
    });
  };

  const handleAssign = (user: UserRow | null) => {
    assignMutation.mutate(user?.onshape_user_id ?? null);
  };

  const handleMachineSelect = (machine: string | null) => {
    machineMutation.mutate(machine);
  };

  const isAssigning = assignMutation.isPending;
  const isSettingMachine = machineMutation.isPending;
  const isLoading = isMoving || isAssigning || isSettingMachine;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 pb-8">
      <div className="bg-card border-border flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg">
        <span className="text-muted-foreground text-sm whitespace-nowrap">
          {selectedCardIds.size} card{selectedCardIds.size !== 1 ? "s" : ""}{" "}
          selected
        </span>

        <div className="bg-border h-4 w-px" />

        {/* Move to column */}
        <Select onValueChange={handleColumnChange} disabled={isLoading}>
          <SelectTrigger className="h-8 w-[140px] gap-1">
            <Columns3 className="size-3.5 opacity-50" />
            <SelectValue placeholder="Move to column" />
          </SelectTrigger>
          <SelectContent>
            {columns.map((col) => {
              const isLastColumn = col.id === columns[columns.length - 1]?.id;
              const label = isLastColumn ? "Done" : col.title;
              return (
                <SelectItem key={col.id} value={col.id}>
                  {label}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        {/* Assign to user */}
        <Popover open={assignPopoverOpen} onOpenChange={setAssignPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              disabled={isLoading}
            >
              {isAssigning ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <User className="size-3.5 opacity-50" />
              )}
              Assign
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0" align="center" side="top">
            <div className="max-h-60 overflow-auto p-1">
              <div
                className="hover:bg-accent hover:text-accent-foreground flex cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 text-sm"
                onClick={() => handleAssign(null)}
                onKeyDown={(e) => e.key === "Enter" && handleAssign(null)}
                role="button"
                tabIndex={0}
              >
                <User className="text-muted-foreground size-4" />
                <span>None (Unassigned)</span>
              </div>
              {sortedUsers.map((user) => (
                <div
                  key={user.onshape_user_id}
                  className="hover:bg-accent hover:text-accent-foreground flex cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 text-sm"
                  onClick={() => handleAssign(user)}
                  onKeyDown={(e) => e.key === "Enter" && handleAssign(user)}
                  role="button"
                  tabIndex={0}
                >
                  <User className="text-primary size-4" />
                  {user.name}
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Set machine */}
        <Popover open={machinePopoverOpen} onOpenChange={setMachinePopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              disabled={isLoading}
            >
              {isSettingMachine ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Wrench className="size-3.5 opacity-50" />
              )}
              Machine
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0" align="center" side="top">
            <div className="max-h-60 overflow-auto p-1">
              <div
                className="hover:bg-accent hover:text-accent-foreground flex cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 text-sm"
                onClick={() => handleMachineSelect(null)}
                onKeyDown={(e) =>
                  e.key === "Enter" && handleMachineSelect(null)
                }
                role="button"
                tabIndex={0}
              >
                <Wrench className="text-muted-foreground size-4" />
                <span>None (Unassigned)</span>
              </div>
              {sortedEquipment.map((item) => (
                <div
                  key={item.id}
                  className="hover:bg-accent hover:text-accent-foreground flex cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 text-sm"
                  onClick={() => handleMachineSelect(item.name)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && handleMachineSelect(item.name)
                  }
                  role="button"
                  tabIndex={0}
                >
                  <Wrench className="text-primary size-4" />
                  {item.name}
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <div className="bg-border h-4 w-px" />

        {/* Clear selection */}
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-8 gap-1", isLoading && "opacity-70")}
          onClick={onClearSelection}
          disabled={isLoading}
        >
          <X className="size-3.5" />
          Clear
        </Button>
      </div>
    </div>
  );
}
