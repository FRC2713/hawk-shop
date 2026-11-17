import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, User, Wrench, X } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import type { KanbanColumn as KanbanColumnType } from "~/server/kanbanApi/columnTypes";
import { ProjectPicker } from "~/components/mfg/ProjectPicker";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  assignCardsToMachine,
  assignKanbanCard,
  equipmentQuery,
  partActions,
  projectsQuery,
  queryKeys,
  updateKanbanCard,
  usersQuery,
  ApiError,
  type KanbanCardWithProcesses,
} from "~/lib/api";
import { eligibleMachines, machineAssignment } from "~/lib/bulkCardActions";
import {
  errorReason,
  forEachCard,
  type BulkOutcome,
} from "~/lib/bulkCardRunner";
import { plural } from "~/lib/plural";
import { useMachineQueueCounts } from "~/components/mfg/kanban/useMachineQueueCounts";
import { useMoveReason } from "./useMoveReason";

type Card = KanbanCardWithProcesses;

interface BulkResult {
  /** What the action did to the cards that changed, e.g. "Moved to Review". */
  success: (changed: number) => string;
  total: number;
  outcome: BulkOutcome<Card>;
}

interface KanbanBulkEditBarProps {
  /** The selected cards, all in one column. */
  cards: Card[];
  columns: KanbanColumnType[];
  onClearSelection: () => void;
  /** Leave these cards selected, e.g. the ones an action couldn't change. */
  onKeepSelected: (ids: string[]) => void;
}

/**
 * The action bar for selected cards: Move to, Assign, Assign machine and
 * Change project. A partial failure names the cards that didn't change and leaves
 * them selected.
 */
export function KanbanBulkEditBar({
  cards,
  columns,
  onClearSelection,
  onKeepSelected,
}: KanbanBulkEditBarProps) {
  const queryClient = useQueryClient();
  const { requestReason, reasonDialog } = useMoveReason();
  const { data: equipment = [] } = useQuery(equipmentQuery());
  const { data: projects = [] } = useQuery(projectsQuery());
  const { data: users = [] } = useQuery(usersQuery());
  const people = useMemo(
    () =>
      [...users].sort((a, b) =>
        (a.name ?? "").localeCompare(b.name ?? "", undefined, {
          sensitivity: "base",
        })
      ),
    [users]
  );

  const machines = useMemo(
    () =>
      eligibleMachines(
        [...equipment].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        ),
        cards
      ),
    [equipment, cards]
  );
  const queueCounts = useMachineQueueCounts(machines);
  const notInBacklog = machineAssignment(null, cards).skipped.length;

  const columnId = cards[0]?.column_id;
  const lastColumnId = columns[columns.length - 1]?.id;

  const action = useMutation({
    mutationFn: (run: () => Promise<BulkResult>) => run(),
    onSuccess: ({ success, total, outcome }) => {
      const { changed, failed } = outcome;
      if (failed.length === 0) {
        toast.success(success(changed.length));
        onClearSelection();
        return;
      }
      toast.error(
        `${failed.length} of ${plural(total, "card")} didn't change`,
        {
          duration: 15000,
          description: (
            <div>
              {changed.length > 0 && <p>{success(changed.length)}.</p>}
              <ul className="list-disc pl-4">
                {failed.map(({ card, reason }) => (
                  <li key={card.id}>
                    {card.title}: {reason}
                  </li>
                ))}
              </ul>
            </div>
          ),
        }
      );
      onKeepSelected(failed.map(({ card }) => card.id));
    },
    onError: (error) => {
      toast.error("Bulk change failed", { description: errorReason(error) });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.kanban.cards() });
    },
  });

  const moveTo = async (target: KanbanColumnType) => {
    const reason = await requestReason(cards, target.id);
    if (reason === null) return;
    action.mutate(async () => ({
      success: (n) => `Moved ${plural(n, "card")} to ${target.title}`,
      total: cards.length,
      outcome: await forEachCard(cards, (card) =>
        partActions.moveCard(card.id, target.id, reason)
      ),
    }));
  };

  const assignPerson = (userId: string | null) => {
    const name =
      people.find((user) => user.onshape_user_id === userId)?.name ?? "them";
    action.mutate(async () => ({
      success: (n) =>
        userId
          ? `Assigned ${plural(n, "card")} to ${name}`
          : `Unassigned ${plural(n, "card")}`,
      total: cards.length,
      outcome: await forEachCard(cards, (card) =>
        assignKanbanCard(card.id, userId)
      ),
    }));
  };

  const assignMachine = (machineId: string | null) => {
    const machine = machines.find((item) => item.id === machineId) ?? null;
    action.mutate(async () => {
      const { send, skipped } = machineAssignment(machine, cards);
      const outcome: BulkOutcome<Card> = { changed: [], failed: skipped };
      try {
        // All or nothing on the server.
        await assignCardsToMachine(
          send.map((card) => card.id),
          machineId
        );
        outcome.changed = send;
      } catch (error) {
        const refused =
          error instanceof ApiError ? new Set(error.cardIds ?? []) : new Set();
        for (const card of send)
          outcome.failed.push({
            card,
            reason:
              refused.size === 0 || refused.has(card.id)
                ? errorReason(error)
                : "not changed, another card was refused",
          });
      }
      return {
        success: (n) =>
          machine
            ? `Assigned ${plural(n, "card")} to ${machine.name}`
            : `Cleared the machine on ${plural(n, "card")}`,
        total: cards.length,
        outcome,
      };
    });
  };

  const changeProject = (projectId: string) => {
    const name =
      projects.find((project) => project.id === projectId)?.name ?? "project";
    action.mutate(async () => {
      const result = await forEachCard(cards, (card) =>
        card.project_id === projectId
          ? Promise.resolve()
          : updateKanbanCard(card.id, { project_id: projectId })
      );
      // Project card counts changed too.
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all() });
      return {
        success: (n) => `Moved ${plural(n, "card")} to ${name}`,
        total: cards.length,
        outcome: result,
      };
    });
  };

  const busy = action.isPending;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 pb-8">
      <div
        role="toolbar"
        aria-label="Selected cards"
        className="bg-card border-border flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 shadow-lg"
      >
        <span className="text-sm font-semibold whitespace-nowrap">
          <span className="brand-figures">{cards.length}</span> selected
        </span>
        {busy && (
          <Loader2
            className="size-4 animate-spin"
            aria-label="Updating cards"
          />
        )}

        <div className="bg-border h-4 w-px" />

        <Select
          value=""
          onValueChange={(id) => {
            const target = columns.find((column) => column.id === id);
            if (target) moveTo(target);
          }}
          disabled={busy}
        >
          <SelectTrigger aria-label="Move to" className="h-8 w-[140px]">
            <SelectValue placeholder="Move to" />
          </SelectTrigger>
          <SelectContent>
            {columns
              .filter((column) => column.id !== columnId)
              .map((column) => (
                <SelectItem key={column.id} value={column.id}>
                  {column.id === lastColumnId ? "Done" : column.title}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              disabled={busy}
            >
              <User className="size-3.5 opacity-50" aria-hidden="true" />
              Assign
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" className="max-h-72 w-56">
            {people.map((user) => (
              <DropdownMenuItem
                key={user.onshape_user_id}
                onSelect={() => assignPerson(user.onshape_user_id)}
              >
                {user.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => assignPerson(null)}>
              Unassigned
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              disabled={busy}
            >
              <Wrench className="size-3.5 opacity-50" aria-hidden="true" />
              Assign machine
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" className="w-64">
            {notInBacklog === cards.length ? (
              <DropdownMenuLabel className="text-muted-foreground font-normal">
                Only Backlog cards can take a machine.
              </DropdownMenuLabel>
            ) : (
              <>
                {notInBacklog > 0 && (
                  <>
                    <DropdownMenuLabel className="text-muted-foreground font-normal">
                      {plural(notInBacklog, "card")} not in Backlog will stay as{" "}
                      {notInBacklog === 1 ? "it is" : "they are"}.
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                  </>
                )}
                {machines.map((machine) => (
                  <DropdownMenuItem
                    key={machine.id}
                    onSelect={() => assignMachine(machine.id)}
                  >
                    <span className="flex-1">{machine.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {queueCounts.get(machine.id) ?? 0} queued
                    </span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => assignMachine(null)}>
                  No machine
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {reasonDialog}
        <div className="w-44">
          <ProjectPicker
            value={null}
            placeholder="Change project"
            aria-label="Change project"
            onChange={changeProject}
            disabled={busy}
          />
        </div>

        <div className="bg-border h-4 w-px" />

        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1"
          onClick={onClearSelection}
          disabled={busy}
        >
          <X className="size-3.5" aria-hidden="true" />
          Clear
        </Button>
      </div>
    </div>
  );
}
