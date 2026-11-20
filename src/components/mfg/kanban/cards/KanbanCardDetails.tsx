import { ErrorMessage } from "~/components/mfg/ErrorDisplay";
import { openProblemReport } from "~/lib/api/reports";
import { useEffect, useState, useMemo, type ReactNode } from "react";
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
  Cog,
  GitCommitHorizontal,
  MoreHorizontal,
  type LucideIcon,
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
import { cn } from "~/lib/utils";
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

/** A moment in history: "Nov 13, 10:14 PM", with the year only when it differs. */
function formatMoment(dateString: string): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "Invalid date";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== new Date().getFullYear()
      ? { year: "numeric" }
      : {}),
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Sheet section headings: Barlow semibold, per the brand's subsection rule. */
const SECTION_HEADING = "font-heading text-base font-semibold";

/** One row of the Details table: a fixed label column and a value. */
function DetailRow({
  icon: Icon,
  label,
  labelFor,
  alignTop = false,
  children,
}: {
  icon: LucideIcon;
  label: string;
  labelFor?: string;
  alignTop?: boolean;
  children: ReactNode;
}) {
  const LabelTag = labelFor ? "label" : "span";
  return (
    <tr>
      <td
        className={cn(
          "text-muted-foreground w-36 py-2 pr-2 pl-3 text-sm font-medium whitespace-nowrap",
          alignTop && "align-top"
        )}
      >
        <div className={cn("flex items-center gap-2", alignTop && "h-9")}>
          <div className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full">
            <Icon className="text-foreground size-3.5" aria-hidden="true" />
          </div>
          <LabelTag htmlFor={labelFor}>{label}</LabelTag>
        </div>
      </td>
      <td className="py-2 pr-3">{children}</td>
    </tr>
  );
}

/** A read-only value, inset to line up with the text inside the pickers. */
function PlainValue({
  children,
  muted = false,
}: {
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-h-9 items-center px-3 text-sm",
        muted && "text-muted-foreground"
      )}
    >
      {children}
    </div>
  );
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

      <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-4">
        {!!card.release_issues?.length && (
          <section
            aria-label="Release warnings"
            className="callout callout-red"
          >
            <h4 className={SECTION_HEADING}>Release warnings</h4>
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
          <div className="bg-muted relative h-44 w-full overflow-hidden rounded-lg">
            <img
              src={imageUrl}
              alt={card.title}
              className="absolute inset-0 size-full object-contain p-2"
              onError={() => setImageError(true)}
            />
          </div>
        )}

        {!!card.review_notes?.length && (
          <section aria-label="Sent back" className="space-y-2">
            <h4 className={SECTION_HEADING}>Sent back</h4>
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
                    className="text-muted-foreground block text-xs"
                  >
                    {formatMoment(note.created_at)}
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
            <h4 className={SECTION_HEADING}>Details</h4>
            <div className="bg-card overflow-hidden rounded-lg border">
              <table className="w-full">
                <tbody className="divide-y">
                  <DetailRow icon={Columns3} label="Status">
                    <Select
                      value={card.column_id}
                      onValueChange={(value) => moveCardMutation.mutate(value)}
                      disabled={moveCardMutation.isPending}
                    >
                      <SelectTrigger className="w-full" aria-label="Status">
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
                      <p className="text-muted-foreground mt-1 px-3 text-xs">
                        Updating...
                      </p>
                    )}
                  </DetailRow>

                  <DetailRow
                    icon={FolderKanban}
                    label="Project"
                    labelFor={`project-${card.id}`}
                  >
                    <ProjectPicker
                      id={`project-${card.id}`}
                      value={card.project_id}
                      onChange={(projectId) => {
                        if (projectId !== card.project_id)
                          projectMutation.mutate(projectId);
                      }}
                      disabled={projectMutation.isPending}
                    />
                  </DetailRow>

                  <DetailRow icon={User} label="Assignee">
                    <AssignCardDialog card={card} />
                  </DetailRow>

                  <DetailRow icon={Wrench} label="Machine">
                    <MachineSelectDialog card={card} />
                  </DetailRow>

                  {card.quantity_to_make && (
                    <DetailRow icon={Hash} label="Quantity">
                      <PlainValue>
                        <span className="brand-figures">
                          {card.quantity_to_make}
                        </span>
                      </PlainValue>
                    </DetailRow>
                  )}

                  {card.processes && card.processes.length > 0 && (
                    <DetailRow icon={Cog} label="Processes" alignTop>
                      <div className="flex min-h-9 flex-wrap items-center gap-1 px-3">
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
                    </DetailRow>
                  )}

                  {card.due_date && dueDateUrgency && (
                    <DetailRow icon={Calendar} label="Due date">
                      <PlainValue>
                        <span
                          className={
                            dueDateUrgency.variant === "destructive"
                              ? "text-emphasis font-semibold"
                              : undefined
                          }
                        >
                          {formatDate(card.due_date)}
                        </span>
                        <span className="text-muted-foreground ml-2 text-xs">
                          {dueDateUrgency.variant === "destructive"
                            ? `Overdue, ${formatRelativeTime(dueDateDiffDays).toLowerCase()}`
                            : formatRelativeTime(dueDateDiffDays)}
                        </span>
                      </PlainValue>
                    </DetailRow>
                  )}

                  {hasOnshapeProperties && (
                    <DetailRow icon={Box} label="Material">
                      <PlainValue
                        muted={!material || material === MATERIAL_UNKNOWN}
                      >
                        {snapshotPending
                          ? "Loading..."
                          : material === null
                            ? "Unknown"
                            : material || "Not set"}
                      </PlainValue>
                    </DetailRow>
                  )}

                  {showVersion && (
                    <DetailRow icon={GitCommitHorizontal} label="Version">
                      <PlainValue>
                        {snapshotPending
                          ? "Loading..."
                          : versionName || "Unknown"}
                      </PlainValue>
                    </DetailRow>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <section aria-label="Status history" className="space-y-2">
          <h4 className={SECTION_HEADING}>Status history</h4>
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
                    className="text-muted-foreground block text-xs"
                  >
                    {formatMoment(entry.moved_at)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* Actions - Sticky at bottom */}
      <div className="bg-background mt-auto space-y-2 border-t p-4">
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
