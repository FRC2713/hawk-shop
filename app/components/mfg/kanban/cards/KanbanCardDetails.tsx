import { useState, useMemo } from "react";
import {
  Calendar,
  Clock,
  Columns3,
  Trash2,
  User,
  Wrench,
  Box,
  ExternalLink,
  Hash,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
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
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
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
import type { KanbanCardRow, UserRow, ProcessRow } from "~/lib/db/types";
import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";
import { Badge } from "~/components/ui/badge";
import type { UseMutationResult } from "@tanstack/react-query";
import { useKanbanColumns } from "~/lib/kanbanApi/queries";
import { AssignCardDialog } from "./AssignCardDialog";
import { MachineSelectDialog } from "./MachineSelectDialog";

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
      className:
        "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    }; // Due soon
  return { variant: "secondary" };
}

/**
 * Construct Onshape document URL from card's database fields
 */
function buildOnshapeDocumentUrl(
  documentId: string,
  instanceType: string,
  instanceId: string,
  elementId: string
): string {
  // Onshape document URLs use 'w' for workspace, 'v' for version, 'm' for microversion
  const wvm = instanceType === "w" ? "w" : instanceType === "v" ? "v" : "m";
  return `https://cad.onshape.com/documents/${documentId}/${wvm}/${instanceId}/e/${elementId}`;
}

interface KanbanCardDetailsProps {
  card: KanbanCardRow & { processes?: ProcessRow[] };
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

  // Build Onshape document URL if properties are available
  // Use version_id when available to ensure we link to the correct version
  const onshapeUrl = useMemo(() => {
    if (!hasOnshapeProperties) return null;

    // Prefer version_id if available - always use it with type 'v' to link to the correct version
    // When instance_type is 'v', instance_id is also the version ID
    const versionIdToUse =
      card.onshape_version_id ||
      (card.onshape_instance_type === "v" ? card.onshape_instance_id : null);

    // If we have a version ID, always use it with type 'v' to link to the correct version
    if (versionIdToUse) {
      return buildOnshapeDocumentUrl(
        card.onshape_document_id!,
        "v", // Always use version type when we have a version ID
        versionIdToUse,
        card.onshape_element_id!
      );
    }

    // Fallback to original instance_id and instance_type
    return buildOnshapeDocumentUrl(
      card.onshape_document_id!,
      card.onshape_instance_type!,
      card.onshape_instance_id!,
      card.onshape_element_id!
    );
  }, [
    hasOnshapeProperties,
    card.onshape_document_id,
    card.onshape_instance_type,
    card.onshape_instance_id,
    card.onshape_version_id,
    card.onshape_element_id,
  ]);

  // Get version ID from card (must be defined before versionQuery)
  const cardVersionId = useMemo(() => {
    // Prefer the dedicated version_id field
    if (card.onshape_version_id) {
      return card.onshape_version_id;
    }
    // Fallback: if instance_type is 'v', use instance_id as version
    if (card.onshape_instance_type === "v" && card.onshape_instance_id) {
      return card.onshape_instance_id;
    }
    return null;
  }, [
    card.onshape_version_id,
    card.onshape_instance_type,
    card.onshape_instance_id,
  ]);

  // Fetch version information if we have a version ID
  const versionQuery = useQuery({
    queryKey: ["onshape-version", card.onshape_document_id, cardVersionId],
    queryFn: async () => {
      if (!card.onshape_document_id || !cardVersionId) {
        throw new Error("Missing document ID or version ID");
      }
      const params = new URLSearchParams({
        documentId: card.onshape_document_id,
        versionId: cardVersionId,
      });
      const response = await fetch(`/api/onshape/version?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch version");
      }
      return response.json();
    },
    enabled: !!card.onshape_document_id && !!cardVersionId,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: 1,
  });

  // Memoize hasMeta to avoid recalculating on every render
  const hasMeta = useMemo(
    () =>
      !!(
        card.column_id ||
        card.assignee ||
        card.machine ||
        card.due_date ||
        card.quantity_per_robot ||
        card.quantity_to_make ||
        (card.processes && card.processes.length > 0)
      ),
    [
      card.column_id,
      card.assignee,
      card.machine,
      card.due_date,
      card.quantity_per_robot,
      card.quantity_to_make,
      card.processes,
    ]
  );

  // Fetch columns for the status dropdown
  const { data: columns = [] } = useKanbanColumns();
  const queryClient = useQueryClient();
  const moveCardMutation = useMutation({
    mutationFn: async (columnId: string) => {
      const response = await fetch(`/api/kanban/cards/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column_id: columnId }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to move card");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kanban-cards"] });
      queryClient.invalidateQueries({ queryKey: ["kanban-columns"] });
    },
  });

  // Get creator from map instead of individual query
  const creator = card.created_by ? usersMap.get(card.created_by) : undefined;

  // Fetch parts from Onshape API to get material
  // Cache for 30 seconds to reduce API calls
  const partsQuery = useQuery<BtPartMetadataInfo[]>({
    queryKey: [
      "onshape-parts",
      card.onshape_document_id,
      card.onshape_instance_type,
      card.onshape_instance_id,
      card.onshape_element_id,
    ],
    queryFn: async () => {
      if (!hasOnshapeProperties) throw new Error("No Onshape properties");
      const params = new URLSearchParams({
        documentId: card.onshape_document_id!,
        instanceType: card.onshape_instance_type!,
        instanceId: card.onshape_instance_id!,
        elementId: card.onshape_element_id!,
      });
      const response = await fetch(`/api/onshape/parts?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch parts");
      }
      return response.json();
    },
    enabled: hasOnshapeProperties,
    staleTime: 30 * 1000, // Cache for 30 seconds
    retry: 1, // Retry once on failure
  });

  // Pre-normalize card title to avoid repeated string operations
  const normalizedCardTitle = useMemo(
    () => card.title?.trim().toLowerCase() ?? null,
    [card.title]
  );

  // Find the matching part by part number and version ID
  // Match by part number first, then verify version if available
  const matchingPart = useMemo(() => {
    if (!partsQuery.data || !normalizedCardTitle) return null;

    // Find parts with matching part number
    const partsWithMatchingNumber = partsQuery.data.filter(
      (part) => part.partNumber?.trim().toLowerCase() === normalizedCardTitle
    );

    if (partsWithMatchingNumber.length === 0) return null;

    // If we have a version ID, try to match by version
    // The parts are from a specific version context (queryParams), so we need to check
    // if the card's version matches the query context version
    if (cardVersionId && card.onshape_instance_id) {
      // Check if the card's instance_id matches the query context
      // This ensures we're matching the right version
      // Note: The partsQuery is already filtered by the query context version
      // So if the card's version matches the query context, the part should match
      // We'll match the first part with the correct part number since parts are already version-specific
      return partsWithMatchingNumber[0] || null;
    }

    // Fallback: return first matching part (for backward compatibility)
    return partsWithMatchingNumber[0] || null;
  }, [
    partsQuery.data,
    normalizedCardTitle,
    cardVersionId,
    card.onshape_instance_id,
  ]);

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
    <SheetContent className="flex w-full flex-col sm:max-w-lg">
      <SheetHeader className="space-y-1">
        <SheetTitle className="text-xl">{card.title}</SheetTitle>
        <SheetDescription className="flex items-center gap-2">
          <Clock className="size-3" />
          Created {formatDate(card.date_created)}
          {card.created_by && ` by ${creator?.name || card.created_by}`}
        </SheetDescription>
      </SheetHeader>

      <div className="mt-6 flex-1 space-y-6 overflow-y-auto px-4">
        {/* Image Section */}
        {imageUrl && !imageError && (
          <div className="overflow-hidden">
            <div className="relative w-full" style={{ height: "300px" }}>
              <Image
                src={imageUrl}
                alt={card.title}
                fill
                className="object-contain"
                onError={() => setImageError(true)}
                unoptimized
              />
            </div>
          </div>
        )}

        {/* Description */}
        {card.content && (
          <div className="space-y-2">
            <h4 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
              Description
            </h4>
            <div className="bg-muted/50 rounded-lg p-4">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {card.content}
              </p>
            </div>
          </div>
        )}

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
                          <div className="flex size-6 items-center justify-center rounded-full bg-amber-500/10">
                            <Box className="size-3.5 text-amber-600" />
                          </div>
                          <span>Material</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {partsQuery.isLoading ? (
                          <span className="text-muted-foreground text-sm">
                            Loading...
                          </span>
                        ) : partsQuery.isError ? (
                          <span className="text-muted-foreground text-sm">
                            Unable to load
                          </span>
                        ) : matchingPart ? (
                          <span className="text-sm">
                            {matchingPart.material?.displayName || "Not Set"}
                          </span>
                        ) : partsQuery.data && card.title ? (
                          <span className="text-muted-foreground text-sm">
                            Part not found
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  )}

                  {/* Version Name */}
                  {cardVersionId && card.onshape_document_id && (
                    <tr>
                      <td className="text-muted-foreground px-4 py-3 text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <div className="flex size-6 items-center justify-center rounded-full bg-purple-500/10">
                            <Box className="size-3.5 text-purple-600" />
                          </div>
                          <span>Version</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm">
                          {versionQuery.isLoading
                            ? "Loading..."
                            : versionQuery.isError
                              ? "Unable to load"
                              : versionQuery.data?.name || "Unknown"}
                        </span>
                      </td>
                    </tr>
                  )}

                  {/* Machine */}
                  <tr>
                    <td className="text-muted-foreground px-4 py-3 text-sm font-medium">
                      <div className="flex items-center gap-2">
                        <div className="flex size-6 items-center justify-center rounded-full bg-blue-500/10">
                          <Wrench className="size-3.5 text-blue-600" />
                        </div>
                        <span>Machine</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <MachineSelectDialog card={card} />
                    </td>
                  </tr>

                  {/* Quantity per Robot */}
                  {card.quantity_per_robot && (
                    <tr>
                      <td className="text-muted-foreground px-4 py-3 text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <div className="flex size-6 items-center justify-center rounded-full bg-green-500/10">
                            <Hash className="size-3.5 text-green-600" />
                          </div>
                          <span>Quantity per Robot</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm">
                          {card.quantity_per_robot}
                        </span>
                      </td>
                    </tr>
                  )}

                  {/* Quantity to Make */}
                  {card.quantity_to_make && (
                    <tr>
                      <td className="text-muted-foreground px-4 py-3 text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <div className="flex size-6 items-center justify-center rounded-full bg-green-500/10">
                            <Hash className="size-3.5 text-green-600" />
                          </div>
                          <span>Quantity to Make</span>
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
                          <div className="flex size-6 items-center justify-center rounded-full bg-blue-500/10">
                            <Wrench className="size-3.5 text-blue-600" />
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
                              className="text-xs"
                            >
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
                                  ? "bg-amber-500/10"
                                  : "bg-muted"
                            }`}
                          >
                            <Calendar
                              className={`size-3.5 ${
                                dueDateUrgency.variant === "destructive"
                                  ? "text-destructive"
                                  : dueDateUrgency.className
                                    ? "text-amber-600"
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
                                ? "text-amber-600"
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
      </div>

      {/* Actions - Sticky at bottom */}
      <div className="mt-auto space-y-2 border-t pt-4">
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

        {/* Delete Action */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground w-full"
              disabled={deleteCardMutation.isPending}
            >
              <Trash2 className="mr-2 size-4" />
              {deleteCardMutation.isPending ? "Deleting..." : "Delete Card"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this card?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete "{card.title}". This action cannot
                be undone.
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
      </div>
    </SheetContent>
  );
}
