import { ErrorMessage } from "~/components/mfg/ErrorDisplay";
import { openProblemReport } from "~/lib/api/reports";
import { useEffect, useState, useMemo } from "react";
import {
  Calendar,
  Clock,
  Columns3,
  Trash2,
  User,
  Wrench,
  Box,
  ExternalLink,
  Flag,
  Hash,
  FolderKanban,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { ProjectPicker } from "~/components/mfg/ProjectPicker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "~/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import type {
  CardMachine,
  KanbanCardRow,
  UserRow,
  ProcessRow,
  ReviewNoteRow,
} from "~/server/db/types";
import { Badge } from "~/components/ui/badge";
import type { UseMutationResult } from "@tanstack/react-query";
import {
  kanbanColumnsQuery,
  kanbanCardDetailsQuery,
  kanbanCardSnapshotQuery,
  queryKeys,
  updateKanbanCard,
} from "~/lib/api";
import { AssignCardDialog } from "./AssignCardDialog";
import { MachineSelectDialog } from "./MachineSelectDialog";
import { SubmitterNotes } from "./SubmitterNotes";
import { WorkflowActions } from "./WorkflowActions";
import { cardOnshapeUrl } from "~/lib/onshapeLinks";
import { ProcessIcon } from "~/components/mfg/processes/ProcessIcon";
import {
  MATERIAL_UNKNOWN,
  needsOnshapeSnapshot,
  snapshotVersionId,
} from "~/lib/cardSnapshot";

/**
 * Format a date string for display
 * Returns "Invalid date" for invalid date strings
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    return "Invalid date";
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Calculate days difference from now
 * Returns null if date is invalid
 */
function getDaysDifference(dateString: string): number | null {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Format relative time (e.g., "2 days ago", "in 3 days")
 */
function formatRelativeTime(diffDays: number | null): string {
  if (diffDays === null) return "";
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays > 0) return `In ${diffDays} days`;
  return `${Math.abs(diffDays)} days ago`;
}

/**
 * Get due date urgency info
 */
function getDueDateUrgency(diffDays: number | null): {
  variant: "destructive" | "secondary" | "outline";
  className?: string;
} {
  if (diffDays === null) return { variant: "secondary" };
  if (diffDays < 0) return { variant: "destructive" }; // Overdue
  if (diffDays <= 2)
    return {
      variant: "outline",
      className: "border-border bg-muted text-foreground",
    }; // Due soon
  return { variant: "secondary" };
}

interface KanbanCardDetailsProps {
  card: KanbanCardRow & {
    processes?: ProcessRow[];
    linked_machine?: CardMachine | null;
    review_notes?: ReviewNoteRow[];
  };
  imageUrl?: string;
  deleteCardMutation: UseMutationResult<unknown, Error, string, unknown>;
  onDelete: () => void;
  usersMap: Map<string, UserRow>;
}

export function KanbanCardDetails({
  card,
  imageUrl,
  deleteCardMutation,
  onDelete,
  usersMap,
}: KanbanCardDetailsProps) {
  const [imageError, setImageError] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reportsEnabled, setReportsEnabled] = useState(false);
  useEffect(
    () => setReportsEnabled(document.body.dataset.reportsEnabled === "true"),
    []
  );
  const detailsQuery = useQuery(kanbanCardDetailsQuery(card.id));

  // Check if card has Onshape properties from database
  const hasOnshapeProperties = useMemo(() => {
    return !!(
      card.onshape_document_id &&
      card.onshape_instance_type &&
      card.onshape_instance_id &&
      card.onshape_element_id
    );
  }, [
    card.onshape_document_id,
    card.onshape_instance_type,
    card.onshape_instance_id,
    card.onshape_element_id,
  ]);

  const onshapeUrl = cardOnshapeUrl(card);

  // Material and version name were captured onto the card at release. A card
  // released before that is filled in once by the server, then never again.
  const snapshotQuery = useQuery(kanbanCardSnapshotQuery(card));
  const snapshotPending = needsOnshapeSnapshot(card) && snapshotQuery.isPending;
  const material =
    card.onshape_material ?? snapshotQuery.data?.onshape_material ?? null;
  const versionName =
    card.onshape_version_name ??
    snapshotQuery.data?.onshape_version_name ??
    null;
  const showVersion = !!card.onshape_version_name || !!snapshotVersionId(card);

  // Memoize hasMeta to avoid recalculating on every render
  const hasMeta = useMemo(
    () =>
      !!(
        card.column_id ||
        card.assignee ||
        card.machine_id ||
        card.machine ||
        card.due_date ||
        card.quantity_to_make ||
        (card.processes && card.processes.length > 0)
      ),
    [
      card.column_id,
      card.assignee,
      card.machine_id,
      card.machine,
      card.due_date,
      card.quantity_to_make,
      card.processes,
    ]
  );

  // Fetch columns for the status dropdown
  const { data: columns = [] } = useQuery(kanbanColumnsQuery());
  const queryClient = useQueryClient();
  const moveCardMutation = useMutation({
    mutationFn: (columnId: string) =>
      updateKanbanCard(card.id, { column_id: columnId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.kanban.cards() });
      queryClient.invalidateQueries({ queryKey: queryKeys.kanban.columns() });
    },
  });
  const projectMutation = useMutation({
    mutationFn: (projectId: string) =>
      updateKanbanCard(card.id, { project_id: projectId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.kanban.cards() });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all() });
    },
    onError: (error) =>
      toast.error("Failed to change project", {
        description: <ErrorMessage error={error} cardId={card.id} />,
      }),
  });

  // Get creator from map instead of individual query
  const creator = card.created_by ? usersMap.get(card.created_by) : undefined;

  // Calculate due date difference once to avoid duplicate Date calculations
  const dueDateDiffDays = useMemo(
    () => (card.due_date ? getDaysDifference(card.due_date) : null),
    [card.due_date]
  );

  // Memoize due date urgency calculation
  const dueDateUrgency = useMemo(
    () =>
      dueDateDiffDays !== null ? getDueDateUrgency(dueDateDiffDays) : null,
    [dueDateDiffDays]
  );

  return (
    <SheetContent
      data-report-card-id={card.id}
      className="flex w-full flex-col sm:max-w-lg"
    >
      <SheetHeader className="space-y-1">
        <div className="flex items-start gap-2 pr-8">
          <SheetTitle className="flex-1 text-xl">{card.title}</SheetTitle>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="More actions"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {reportsEnabled && (
                <DropdownMenuItem
                  onSelect={() => openProblemReport({ card_id: card.id })}
                >
                  <Flag className="mr-2 size-4" />
                  Report a problem
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                variant="destructive"
                disabled={deleteCardMutation.isPending}
                onSelect={() => setDeleteOpen(true)}
              >
                <Trash2 className="mr-2 size-4" />
                {deleteCardMutation.isPending ? "Deleting..." : "Delete card"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <SheetDescription className="flex items-center gap-2">
          <Clock className="size-3" />
          Created {formatDate(card.date_created)}
          {card.created_by && ` by ${creator?.name || card.created_by}`}
        </SheetDescription>
      </SheetHeader>

      <div className="mt-6 flex-1 space-y-6 overflow-y-auto px-4">
        {!!card.release_issues?.length && (
          <section
            aria-label="Release warnings"
            className="border-border bg-muted border-l-4 p-3"
          >
            <h4 className="font-semibold">Release warnings</h4>
            <p className="text-muted-foreground mt-1 text-xs">
              Recorded when this part was released.
            </p>
            <ul className="mt-3 space-y-3 text-sm">
              {card.release_issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>
                  <p className="font-semibold">{issue.message}</p>
                  {issue.fix && <p className="mt-1">{issue.fix}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {/* Image Section */}
        {imageUrl && !imageError && (
          <div className="overflow-hidden">
            <div className="relative w-full" style={{ height: "300px" }}>
              <img
                src={imageUrl}
                alt={card.title}
                className="absolute inset-0 size-full object-contain"
                onError={() => setImageError(true)}
              />
            </div>
          </div>
        )}

        {!!card.review_notes?.length && (
          <section aria-label="Sent back" className="space-y-2">
            <h4 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
              Sent back
            </h4>
            <ol className="divide-y rounded-lg border">
              {card.review_notes.map((note) => (
                <li key={note.id} className="space-y-1 px-4 py-3 text-sm">
                  <p className="leading-relaxed break-words whitespace-pre-wrap">
                    {note.text}
                  </p>
                  <p className="text-muted-foreground break-words">
                    {note.author_name}
                  </p>
                  <time
                    dateTime={note.created_at}
                    className="brand-figures text-muted-foreground block text-xs"
                  >
                    {new Date(note.created_at).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
          </section>
        )}

        <SubmitterNotes
          key={card.id}
          cardId={card.id}
          notes={card.content}
          submitterName={creator?.name || "the submitter"}
        />

        {/* Details Table */}
        {hasMeta && (
          <div className="space-y-2">
            <h4 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
              Details
            </h4>
            <div className="bg-card overflow-hidden rounded-lg border">
              <table className="w-full">
                <tbody className="divide-y">
                  {/* Column / Status */}
                  <tr>
                    <td className="text-muted-foreground w-1/3 px-4 py-3 text-sm font-medium">
                      <div className="flex items-center gap-2">
                        <div className="bg-primary/10 flex size-6 items-center justify-center rounded-full">
                          <Columns3 className="text-primary size-3.5" />
                        </div>
                        <span>Status</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <Select
                          value={card.column_id}
                          onValueChange={(value) =>
                            moveCardMutation.mutate(value)
                          }
                          disabled={moveCardMutation.isPending}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                          <SelectContent>
                            {columns
                              .slice()
                              .sort((a, b) => a.position - b.position)
                              .map((col) => (
                                <SelectItem key={col.id} value={col.id}>
                                  {col.title}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        {moveCardMutation.isPending && (
                          <p className="text-muted-foreground text-xs">
                            Updating...
                          </p>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Project */}
                  <tr>
                    <td className="text-muted-foreground w-1/3 px-4 py-3 text-sm font-medium">
                      <div className="flex items-center gap-2">
                        <div className="bg-muted flex size-6 items-center justify-center rounded-full">
                          <FolderKanban className="text-foreground size-3.5" />
                        </div>
                        <label htmlFor={`project-${card.id}`}>Project</label>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <ProjectPicker
                        id={`project-${card.id}`}
                        value={card.project_id}
                        onChange={(projectId) => {
                          if (projectId !== card.project_id)
                            projectMutation.mutate(projectId);
                        }}
                        disabled={projectMutation.isPending}
                      />
                    </td>
                  </tr>

                  {/* Assignee */}
                  <tr>
                    <td className="text-muted-foreground w-1/3 px-4 py-3 text-sm font-medium">
                      <div className="flex items-center gap-2">
                        <div className="bg-primary/10 flex size-6 items-center justify-center rounded-full">
                          <User className="text-primary size-3.5" />
                        </div>
                        <span>Assignee</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <AssignCardDialog card={card} />
                    </td>
                  </tr>

                  {/* Material */}
                  {hasOnshapeProperties && (
                    <tr>
                      <td className="text-muted-foreground px-4 py-3 text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <div className="bg-muted flex size-6 items-center justify-center rounded-full">
                            <Box className="text-foreground size-3.5" />
                          </div>
                          <span>Material</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            material && material !== MATERIAL_UNKNOWN
                              ? "text-sm"
                              : "text-muted-foreground text-sm"
                          }
                        >
                          {snapshotPending
                            ? "Loading..."
                            : material === null
                              ? "Unknown"
                              : material || "Not set"}
                        </span>
                      </td>
                    </tr>
                  )}

                  {/* Version Name */}
                  {showVersion && (
                    <tr>
                      <td className="text-muted-foreground px-4 py-3 text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <div className="bg-muted flex size-6 items-center justify-center rounded-full">
                            <Box className="text-foreground size-3.5" />
                          </div>
                          <span>Version</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm">
                          {snapshotPending
                            ? "Loading..."
                            : versionName || "Unknown"}
                        </span>
                      </td>
                    </tr>
                  )}

                  {/* Machine */}
                  <tr>
                    <td className="text-muted-foreground px-4 py-3 text-sm font-medium">
                      <div className="flex items-center gap-2">
                        <div className="bg-muted flex size-6 items-center justify-center rounded-full">
                          <Wrench className="text-foreground size-3.5" />
                        </div>
                        <span>Machine</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <MachineSelectDialog card={card} />
                    </td>
                  </tr>

                  {/* Quantity to make */}
                  {card.quantity_to_make && (
                    <tr>
                      <td className="text-muted-foreground px-4 py-3 text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <div className="bg-muted flex size-6 items-center justify-center rounded-full">
                            <Hash className="text-foreground size-3.5" />
                          </div>
                          <span>Quantity to make</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm">{card.quantity_to_make}</span>
                      </td>
                    </tr>
                  )}

                  {/* Required Processes */}
                  {card.processes && card.processes.length > 0 && (
                    <tr>
                      <td className="text-muted-foreground px-4 py-3 align-top text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <div className="bg-muted flex size-6 items-center justify-center rounded-full">
                            <Wrench className="text-foreground size-3.5" />
                          </div>
                          <span>Required Processes</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {card.processes.map((process) => (
                            <Badge
                              key={process.id}
                              variant="secondary"
                              className="gap-1 text-xs"
                            >
                              <ProcessIcon
                                process={process}
                                className="size-3.5"
                              />
                              {process.name}
                            </Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}

                  {/* Due Date */}
                  {card.due_date && dueDateUrgency && (
                    <tr>
                      <td className="text-muted-foreground px-4 py-3 text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <div
                            className={`flex size-6 items-center justify-center rounded-full ${
                              dueDateUrgency.variant === "destructive"
                                ? "bg-destructive/10"
                                : dueDateUrgency.className
                                  ? "bg-muted"
                                  : "bg-muted"
                            }`}
                          >
                            <Calendar
                              className={`size-3.5 ${
                                dueDateUrgency.variant === "destructive"
                                  ? "text-destructive"
                                  : dueDateUrgency.className
                                    ? "text-foreground"
                                    : "text-muted-foreground"
                              }`}
                            />
                          </div>
                          <span>Due Date</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-sm ${
                            dueDateUrgency.variant === "destructive"
                              ? "text-destructive"
                              : dueDateUrgency.className
                                ? "text-foreground"
                                : ""
                          }`}
                        >
                          {formatDate(card.due_date)}
                          <span className="text-muted-foreground ml-2 text-xs">
                            ({formatRelativeTime(dueDateDiffDays)})
                          </span>
                        </span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <section aria-label="Status history" className="space-y-2">
          <h4 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
            Status history
          </h4>
          {detailsQuery.isPending ? (
            <p className="text-muted-foreground text-sm" role="status">
              Loading status history...
            </p>
          ) : detailsQuery.isError ? (
            <div role="alert" className="space-y-2">
              <ErrorMessage error={detailsQuery.error} cardId={card.id} />
              <Button
                variant="outline"
                size="sm"
                onClick={() => void detailsQuery.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : detailsQuery.data.status_history.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No status changes recorded yet.
            </p>
          ) : (
            <ol className="divide-y rounded-lg border">
              {detailsQuery.data.status_history.map((entry) => (
                <li key={entry.id} className="space-y-1 px-4 py-3 text-sm">
                  <p className="font-semibold break-words">
                    {entry.from_status === null
                      ? `Released into ${entry.to_status}`
                      : `${entry.from_status} → ${entry.to_status}`}
                  </p>
                  <p className="text-muted-foreground break-words">
                    {entry.actor_name}
                  </p>
                  <time
                    dateTime={entry.moved_at}
                    className="brand-figures text-muted-foreground block text-xs"
                  >
                    {new Date(entry.moved_at).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* Actions - Sticky at bottom */}
      <div className="mt-auto space-y-2 border-t pt-4">
        <WorkflowActions card={card} />
        {/* Open in Onshape Button */}
        {onshapeUrl && (
          <Button
            variant="default"
            size="sm"
            className="w-full"
            onClick={() =>
              window.open(onshapeUrl, "_blank", "noopener,noreferrer")
            }
          >
            <ExternalLink className="mr-2 size-4" />
            Open in Onshape
          </Button>
        )}
      </div>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this card?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{card.title}". This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SheetContent>
  );
}
