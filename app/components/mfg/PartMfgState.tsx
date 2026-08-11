"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useEffect, useRef, useState } from "react";
import type { KanbanColumn } from "~/lib/kanbanApi/columnTypes";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";
import type { KanbanCardRow, ProcessRow } from "~/lib/db/types";
import { isPartEligibleForRelease } from "~/onshape_connector/utils/partEligibility";
import { extractVersionId } from "~/onshape_connector/utils/versionUtils";
import type { PartsPageSearchParams } from "~/onshape_connector/page";
import { type AddCardFormData, AddCardDialog } from "./AddCardDialog";
import { ManufacturingStateBadge } from "./ManufacturingStateBadge";
import { PartDueDate } from "./PartDueDate";
import { PartColorChip } from "./parts/PartColorChip";

interface PartMfgStateProps {
  partNumber: string;
  partId: string;
  part?: BtPartMetadataInfo;
  thumbnailUrl?: string;
  onshapeParams?: {
    documentId: string;
    instanceType: string;
    instanceId: string;
    elementId: string;
  };
  matchingCard?: KanbanCardRow & { processes?: ProcessRow[] };
  currentColumn?: KanbanColumn;
  queryParams?: PartsPageSearchParams;
}

/**
 * Component to display manufacturing tracking state for a part
 */
export function PartMfgState({
  partNumber,
  partId,
  part,
  thumbnailUrl,
  onshapeParams,
  matchingCard,
  currentColumn,
  queryParams,
}: PartMfgStateProps) {
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [result, setResult] = useState<{
    success?: boolean;
    error?: string;
  } | null>(null);
  const hasRevalidatedRef = useRef(false);

  // Get version ID and fetch version info if we have query params
  const versionId = queryParams ? extractVersionId(queryParams) : null;
  const versionQuery = useQuery({
    queryKey: ["onshape-version", queryParams?.documentId, versionId],
    queryFn: async () => {
      if (!queryParams?.documentId || !versionId) {
        throw new Error("Missing document ID or version ID");
      }
      const params = new URLSearchParams({
        documentId: queryParams.documentId,
        versionId: versionId,
      });
      const response = await fetch(`/api/onshape/version?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch version");
      }
      return response.json();
    },
    enabled:
      !!queryParams?.documentId &&
      !!versionId &&
      queryParams.instanceType === "v",
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: 1,
  });

  // Reset revalidation flag when starting a new operation
  useEffect(() => {
    if (isSubmitting) {
      hasRevalidatedRef.current = false;
    }
  }, [isSubmitting]);

  // Handle successful card operations - invalidate queries to refetch
  useEffect(() => {
    if (result?.success && !isSubmitting && !hasRevalidatedRef.current) {
      hasRevalidatedRef.current = true;

      // Invalidate both cards and columns queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ["kanban-cards"] });
      queryClient.invalidateQueries({ queryKey: ["kanban-columns"] });
    }
  }, [result?.success, isSubmitting, queryClient]);

  const handleAddCard = async (formData: AddCardFormData) => {
    setIsSubmitting(true);
    setResult(null);
    setDialogOpen(false);

    const submitFormData = new FormData();
    submitFormData.append("action", "addCard");
    submitFormData.append("partNumber", partNumber);

    // Add process IDs
    formData.processIds.forEach((processId) => {
      submitFormData.append("processIds", processId);
    });

    // Add quantities
    submitFormData.append(
      "quantityPerRobot",
      String(formData.quantityPerRobot)
    );
    submitFormData.append("quantityToMake", String(formData.quantityToMake));

    // Add due date if provided
    if (formData.dueDate) {
      submitFormData.append("dueDate", format(formData.dueDate, "yyyy-MM-dd"));
    }

    if (onshapeParams) {
      submitFormData.append("documentId", onshapeParams.documentId);
      submitFormData.append("instanceType", onshapeParams.instanceType);
      submitFormData.append("instanceId", onshapeParams.instanceId);
      submitFormData.append("elementId", onshapeParams.elementId);
      submitFormData.append("partId", partId);
    }

    // Add thumbnail URL if available
    if (thumbnailUrl) {
      submitFormData.append("rawThumbnailUrl", thumbnailUrl);
    }

    try {
      const response = await fetch("/api/mfg/parts/actions", {
        method: "POST",
        body: submitFormData,
      });
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({ success: false, error: "Failed to add card" });
    } finally {
      setIsSubmitting(false);
    }
  };

  // If card not found, show part properties and "Add to manufacturing tracker" button
  if (!matchingCard) {
    const isEligible = isPartEligibleForRelease(part, matchingCard);
    const isButtonDisabled = isSubmitting || !isEligible;

    return (
      <div className="space-y-2">
        {part && (
          <table className="w-full text-xs">
            <tbody className="divide-border divide-y">
              <tr>
                <td className="text-muted-foreground py-1.5 pr-4 font-medium">
                  Material
                </td>
                <td className="py-1.5">
                  <Badge variant="secondary">
                    {part.material?.displayName || "Not Set"}
                  </Badge>
                </td>
              </tr>
              <tr>
                <td className="text-muted-foreground py-1.5 pr-4 font-medium">
                  Appearance
                </td>
                <td className="py-1.5">
                  <PartColorChip color={part.appearance?.color} />
                </td>
              </tr>
            </tbody>
          </table>
        )}
        <AddCardDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSubmit={handleAddCard}
          isSubmitting={isSubmitting}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full"
          disabled={isButtonDisabled}
          onClick={() => setDialogOpen(true)}
        >
          Release
        </Button>
        {!isEligible && (
          <p className="text-muted-foreground text-xs">
            {!part?.material?.displayName
              ? "Set the material on this part in Onshape to add it to the manufacturing tracker."
              : !part?.partNumber
                ? "Set the part number on this part in Onshape to add it to the manufacturing tracker."
                : "This part cannot be added to the manufacturing tracker."}
          </p>
        )}
        {result && !result.success && result.error && (
          <p className="text-destructive text-xs">{result.error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <table className="w-full text-xs">
        <tbody className="divide-border divide-y">
          {part && (
            <>
              <tr>
                <td className="text-muted-foreground py-1.5 pr-4 font-medium">
                  Material
                </td>
                <td className="py-1.5">
                  <Badge variant="secondary">
                    {part.material?.displayName || "Not Set"}
                  </Badge>
                </td>
              </tr>

              <tr>
                <td className="text-muted-foreground py-1.5 pr-4 font-medium">
                  Appearance
                </td>
                <td className="py-1.5">
                  <PartColorChip color={part.appearance?.color} />
                </td>
              </tr>
              {versionQuery.data?.name && (
                <tr>
                  <td className="text-muted-foreground py-1.5 pr-4 font-medium">
                    Version
                  </td>
                  <td className="py-1.5">
                    <Badge variant="secondary">
                      {versionQuery.isLoading
                        ? "Loading..."
                        : versionQuery.isError
                          ? "Unable to load"
                          : versionQuery.data?.name || "Unknown"}
                    </Badge>
                  </td>
                </tr>
              )}
            </>
          )}
          <tr>
            <td className="text-muted-foreground py-1.5 pr-4 font-medium">
              Manufacturing State
            </td>
            <td className="py-1.5">
              {currentColumn ? (
                <ManufacturingStateBadge column={currentColumn} />
              ) : (
                <span className="text-muted-foreground">Not Set</span>
              )}
            </td>
          </tr>
          <tr>
            <td className="text-muted-foreground py-1.5 pr-4 font-medium">
              Quantity per Robot
            </td>
            <td className="py-1.5">
              <Badge variant="secondary">
                {matchingCard?.quantity_per_robot || "Not Set"}
              </Badge>
            </td>
          </tr>
          <tr>
            <td className="text-muted-foreground py-1.5 pr-4 font-medium">
              Quantity to Make
            </td>
            <td className="py-1.5">
              <Badge variant="secondary">
                {matchingCard?.quantity_to_make || "Not Set"}
              </Badge>
            </td>
          </tr>
          {matchingCard.processes && matchingCard.processes.length > 0 && (
            <tr>
              <td className="text-muted-foreground py-1.5 pr-4 align-top font-medium">
                Processes
              </td>
              <td className="py-1.5">
                <div className="flex flex-wrap gap-1">
                  {matchingCard.processes.map((process: ProcessRow) => (
                    <Badge
                      key={process.id}
                      variant="secondary"
                      className="gap-1 bg-purple-500/10 text-xs font-normal text-purple-700 dark:text-purple-400"
                    >
                      {process.name}
                    </Badge>
                  ))}
                </div>
              </td>
            </tr>
          )}
          <tr>
            <td className="text-muted-foreground py-1.5 pr-4 font-medium">
              Due Date
            </td>
            <td className="py-1.5">
              <PartDueDate card={matchingCard} />
            </td>
          </tr>
        </tbody>
      </table>
      {result && !result.success && result.error && (
        <p className="text-destructive mt-2 text-xs">{result.error}</p>
      )}
    </div>
  );
}
