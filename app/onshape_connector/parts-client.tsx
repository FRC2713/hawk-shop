import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertCircle, Box } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  BulkReleaseDialog,
  BulkReleaseFormData,
} from "~/components/mfg/BulkReleaseDialog";
import { ErrorDisplay } from "~/components/mfg/ErrorDisplay";
import { PartCard } from "~/components/mfg/PartCard";
import { PartCardSkeleton } from "~/components/mfg/PartCardSkeleton";
import { PartListElement } from "~/components/mfg/PartListElement";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Separator } from "~/components/ui/separator";
import { Skeleton } from "~/components/ui/skeleton";
import { partActions, queryKeys } from "~/lib/api";
import { usePartsData } from "./hooks/usePartsData";
import { usePartsSearch } from "./hooks/usePartsSearch";
import {
  type SortBy,
  type SortDirection,
  usePartsSort,
} from "./hooks/usePartsSort";
import { OnshapeConnectorToolbar } from "./OnshapeConnectorToolbar";
import type { PartsPageSearchParams } from "./utils/types";
import { isPartEligibleForRelease } from "./utils/partEligibility";
import { extractVersionId, getPartVersionKey } from "./utils/versionUtils";

interface MfgPartsClientProps {
  queryParams: PartsPageSearchParams;
}

//example url: http://localhost:3000/onshape_connector?elementType=PARTSTUDIO&documentId=6fcef187b1ff2c7d43932486&instanceType=w&instanceId=0330c62599ec344c4a9b77a5&elementId=21aa6247faa0fb5954a76f5b
//             http://localhost:3000/onshape_connector?elementType=PARTSTUDIO&documentId=53c38f13ca333ed762a7da35&instanceType=v&instanceId=d1415051313f9c6e9d96da02&elementId=c928e6ec72d8ad05c31d8aa4
export function MfgPartsClient({ queryParams }: MfgPartsClientProps) {
  const queryClient = useQueryClient();
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [viewMode, setViewMode] = useState<"cards" | "list">("cards");
  const [hideReleased, setHideReleased] = useState(false);

  // Selection state management
  const [selectedPartKeys, setSelectedPartKeys] = useState<Set<string>>(
    new Set()
  );
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(
    null
  );

  // Bulk release state
  const [bulkReleaseDialogOpen, setBulkReleaseDialogOpen] = useState(false);
  const [isBulkReleasing, setIsBulkReleasing] = useState(false);

  // Fetch all data using unified hook
  const {
    parts,
    cardByPartNumber,
    columnById,
    isLoading,
    isError,
    error,
    partsError,
    cardsError,
    columnsError,
  } = usePartsData({ queryParams });

  // Search functionality
  const { searchQuery, setSearchQuery, filteredParts, isSearching } =
    usePartsSearch({ parts });

  // Sort functionality
  const sortedParts = usePartsSort({
    parts: filteredParts,
    sortBy,
    sortDirection,
    cardByPartNumber,
    columnById,
  });

  // Filter out released parts when hideReleased is enabled
  const displayedParts = useMemo(() => {
    if (!hideReleased) return sortedParts;
    const versionId = extractVersionId(queryParams);
    return sortedParts.filter((part) => {
      const compositeKey = part.partNumber
        ? getPartVersionKey(part.partNumber, versionId)
        : null;
      const matchingCard = compositeKey
        ? (cardByPartNumber.get(compositeKey) ??
          cardByPartNumber.get(part.partNumber!))
        : undefined;
      return !matchingCard;
    });
  }, [hideReleased, sortedParts, cardByPartNumber, queryParams]);

  // Check eligibility for selected parts
  const selectedPartsInfo = useMemo(() => {
    if (selectedPartKeys.size === 0) {
      return {
        selectedParts: [],
        eligibleParts: [],
        ineligibleParts: [],
        allEligible: true,
      };
    }

    const versionId = extractVersionId(queryParams);
    const selectedParts = sortedParts.filter((part) => {
      const partKey =
        part.partId ||
        part.id ||
        part.partIdentity ||
        `${part.name || "unknown"}-${part.partNumber || "no-number"}-${versionId}`;
      return selectedPartKeys.has(partKey);
    });

    const eligibleParts: Array<{
      part: (typeof sortedParts)[0];
      partKey: string;
      matchingCard: ReturnType<typeof cardByPartNumber.get>;
      thumbnailUrl?: string;
      onshapeParams?: {
        documentId: string;
        instanceType: string;
        instanceId: string;
        elementId: string;
      };
      partId: string;
    }> = [];
    const ineligibleParts: Array<{
      part: (typeof sortedParts)[0];
      partKey: string;
      reason: string;
    }> = [];

    selectedParts.forEach((part) => {
      const partKey =
        part.partId ||
        part.id ||
        part.partIdentity ||
        `${part.name || "unknown"}-${part.partNumber || "no-number"}-${versionId}`;
      // Match using composite key (partNumber::versionId)
      const matchingCard = part.partNumber
        ? (() => {
            const versionId = extractVersionId(queryParams);
            const compositeKey = getPartVersionKey(part.partNumber, versionId);
            // Try composite key first
            let card = cardByPartNumber.get(compositeKey);
            // Fallback to partNumber only for backward compatibility with old cards
            if (!card) {
              card = cardByPartNumber.get(part.partNumber);
            }
            return card;
          })()
        : undefined;

      const isEligible = isPartEligibleForRelease(part, matchingCard);

      if (isEligible) {
        // Extract thumbnail URL
        const thumbnailUrl =
          part.thumbnailInfo?.sizes?.find((s) => s.size === "300x300")?.href ||
          part.thumbnailInfo?.sizes?.[0]?.href ||
          part.thumbnailInfo?.sizes?.find((s) => s.size === "600x340")?.href;

        // Extract onshape params
        const onshapeParams = queryParams.documentId
          ? {
              documentId: queryParams.documentId,
              instanceType: queryParams.instanceType,
              instanceId: queryParams.instanceId || "",
              elementId: queryParams.elementId || "",
            }
          : undefined;

        const partId = part.partId || part.id || "";

        eligibleParts.push({
          part,
          partKey,
          matchingCard,
          thumbnailUrl,
          onshapeParams,
          partId,
        });
      } else {
        let reason = "Unknown reason";
        if (!part.material?.displayName) {
          reason = "Missing material";
        } else if (!part.partNumber) {
          reason = "Missing part number";
        } else if (matchingCard) {
          reason = "Already in manufacturing tracker";
        }

        ineligibleParts.push({
          part,
          partKey,
          reason,
        });
      }
    });

    return {
      selectedParts,
      eligibleParts,
      ineligibleParts,
      allEligible: ineligibleParts.length === 0 && eligibleParts.length > 0,
    };
  }, [selectedPartKeys, sortedParts, cardByPartNumber, queryParams]);

  // Selection handler function
  const handlePartSelect = useCallback(
    (
      e: React.MouseEvent,
      partKey: string,
      index: number,
      allPartKeys: string[]
    ) => {
      e.stopPropagation();

      const isShiftClick = e.shiftKey;
      const isModifierClick = e.metaKey || e.ctrlKey;

      setSelectedPartKeys((prev) => {
        const newSelection = new Set(prev);

        if (isShiftClick && lastSelectedIndex !== null) {
          // Range selection: select all parts between lastSelectedIndex and current index
          const startIndex = Math.min(lastSelectedIndex, index);
          const endIndex = Math.max(lastSelectedIndex, index);

          for (let i = startIndex; i <= endIndex; i++) {
            if (allPartKeys[i]) {
              newSelection.add(allPartKeys[i]);
            }
          }
        } else {
          // Normal click or modifier click: toggle the current card
          if (newSelection.has(partKey)) {
            newSelection.delete(partKey);
          } else {
            newSelection.add(partKey);
          }
        }

        return newSelection;
      });

      // Update last selected index
      setLastSelectedIndex(index);
    },
    [lastSelectedIndex]
  );

  const invalidateAfterRelease = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.kanban.cards() });
    queryClient.invalidateQueries({ queryKey: queryKeys.kanban.columns() });
    queryClient.invalidateQueries({
      queryKey: queryKeys.onshape.parts(queryParams, true),
    });
  };

  const handleRefresh = invalidateAfterRelease;

  // Bulk release handler
  const handleBulkRelease = async (formData: BulkReleaseFormData) => {
    setIsBulkReleasing(true);
    setBulkReleaseDialogOpen(false);

    const results: Array<{
      partKey: string;
      success: boolean;
      error?: string;
    }> = [];

    // Process each eligible part
    for (const eligiblePart of selectedPartsInfo.eligibleParts) {
      const partQuantities = formData.partQuantities.find(
        (pq: {
          partKey: string;
          quantityPerRobot: number | "";
          quantityToMake: number | "";
        }) => pq.partKey === eligiblePart.partKey
      );

      if (!partQuantities) {
        results.push({
          partKey: eligiblePart.partKey,
          success: false,
          error: "Missing quantity data",
        });
        continue;
      }

      try {
        const data = await partActions.addCard({
          partNumber: eligiblePart.part.partNumber || "",
          processIds: formData.processIds,
          quantityPerRobot: partQuantities.quantityPerRobot,
          quantityToMake: partQuantities.quantityToMake,
          dueDate: formData.dueDate
            ? format(formData.dueDate, "yyyy-MM-dd")
            : undefined,
          onshapePart: eligiblePart.onshapeParams
            ? {
                ...eligiblePart.onshapeParams,
                partId: eligiblePart.partId,
              }
            : undefined,
          rawThumbnailUrl: eligiblePart.thumbnailUrl,
        });
        results.push({
          partKey: eligiblePart.partKey,
          success: data.success,
          error: data.error,
        });
      } catch (error) {
        results.push({
          partKey: eligiblePart.partKey,
          success: false,
          error: "Failed to add card",
        });
      }
    }

    setIsBulkReleasing(false);

    invalidateAfterRelease();

    // Clear selection after successful release
    const allSucceeded = results.every((r) => r.success);
    if (allSucceeded) {
      setSelectedPartKeys(new Set());
      setLastSelectedIndex(null);
    }

    // Log results (could show a toast notification here)
    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;
    if (failureCount > 0) {
      console.warn(
        `Bulk release completed: ${successCount} succeeded, ${failureCount} failed`
      );
    }
  };

  // Determine if we should show loading state
  const showLoading = isLoading && queryParams?.documentId;

  // Combine all errors
  const displayError =
    (partsError ? String(partsError.message) : null) ||
    (cardsError
      ? `Failed to load kanban cards: ${cardsError.message}`
      : null) ||
    (columnsError ? `Failed to load columns: ${columnsError.message}` : null);

  // Show loading screen while data is being fetched
  if (showLoading) {
    return (
      <main className="container mx-auto px-4 py-8">
        <div className="mx-auto max-w-6xl space-y-6">
          {/* Header Skeleton */}
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Box className="h-8 w-8" />
                <Skeleton className="h-8 w-48" />
              </div>
              <Skeleton className="h-5 w-32" />
            </div>
          </div>

          {/* Parts Grid Skeleton */}
          <div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <PartCardSkeleton key={index} />
              ))}
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-2">
        {/* Error Messages */}
        {displayError && <ErrorDisplay error={displayError} />}

        {/* Partial error states - show data even if some queries failed */}
        {(cardsError || columnsError) && !partsError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Partial data loaded</AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>
                {cardsError && "Kanban cards failed to load. "}
                {columnsError && "Columns failed to load. "}
                Parts data is available, but some features may be limited.
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                className="ml-4"
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Search and Sort Controls */}
        {parts && !displayError && (
          <OnshapeConnectorToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            sortBy={sortBy}
            onSortByChange={setSortBy}
            sortDirection={sortDirection}
            onSortDirectionChange={setSortDirection}
            onRefresh={handleRefresh}
            isFetching={isLoading}
            resultCount={displayedParts.length}
            totalCount={parts.length}
            isSearching={isSearching}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            hideReleased={hideReleased}
            onHideReleasedChange={setHideReleased}
          />
        )}

        <Separator />

        {/* Parts List */}
        {parts && parts.length === 0 && !displayError && (
          <Card>
            <CardContent className="pt-6">
              <p className="text-muted-foreground text-center">
                No parts found in this Part Studio.
              </p>
            </CardContent>
          </Card>
        )}

        {parts && parts.length > 0 && queryParams && (
          <div>
            {displayedParts.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <div className="space-y-2 text-center">
                    <p className="text-muted-foreground">
                      No parts match your search query.
                    </p>
                    {searchQuery && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSearchQuery("")}
                      >
                        Clear search
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : viewMode === "cards" ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {displayedParts.map((part, index) => {
                  // Generate a stable key - include version ID for uniqueness across versions
                  const versionId = extractVersionId(queryParams);
                  const partKey =
                    part.partId ||
                    part.id ||
                    part.partIdentity ||
                    `${part.name || "unknown"}-${part.partNumber || "no-number"}-${versionId}`;

                  // Find matching card and column using lookup maps (O(1) access)
                  // Match using composite key (partNumber::versionId)
                  const matchingCard = part.partNumber
                    ? (() => {
                        const compositeKey = getPartVersionKey(
                          part.partNumber,
                          versionId
                        );
                        // Try composite key first
                        let card = cardByPartNumber.get(compositeKey);
                        // Fallback to partNumber only for backward compatibility with old cards
                        if (!card) {
                          card = cardByPartNumber.get(part.partNumber);
                        }
                        return card;
                      })()
                    : undefined;
                  const currentColumn = matchingCard?.column_id
                    ? columnById.get(matchingCard.column_id)
                    : undefined;

                  // Generate all part keys for range selection (include version for uniqueness)
                  const allPartKeys = displayedParts.map(
                    (p) =>
                      p.partId ||
                      p.id ||
                      p.partIdentity ||
                      `${p.name || "unknown"}-${p.partNumber || "no-number"}-${versionId}`
                  );

                  return (
                    <PartCard
                      key={partKey}
                      part={part}
                      queryParams={queryParams}
                      matchingCard={matchingCard}
                      currentColumn={currentColumn}
                      isSelected={selectedPartKeys.has(partKey)}
                      onSelect={(e) =>
                        handlePartSelect(e, partKey, index, allPartKeys)
                      }
                      partKey={partKey}
                      index={index}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {displayedParts.map((part, index) => {
                  // Generate a stable key - include version ID for uniqueness across versions
                  const versionId = extractVersionId(queryParams);
                  const partKey =
                    part.partId ||
                    part.id ||
                    part.partIdentity ||
                    `${part.name || "unknown"}-${part.partNumber || "no-number"}-${versionId}`;

                  // Find matching card and column using lookup maps (O(1) access)
                  // Match using composite key (partNumber::versionId)
                  const matchingCard = part.partNumber
                    ? (() => {
                        const compositeKey = getPartVersionKey(
                          part.partNumber,
                          versionId
                        );
                        // Try composite key first
                        let card = cardByPartNumber.get(compositeKey);
                        // Fallback to partNumber only for backward compatibility with old cards
                        if (!card) {
                          card = cardByPartNumber.get(part.partNumber);
                        }
                        return card;
                      })()
                    : undefined;
                  const currentColumn = matchingCard?.column_id
                    ? columnById.get(matchingCard.column_id)
                    : undefined;

                  // Generate all part keys for range selection (include version for uniqueness)
                  const allPartKeys = displayedParts.map(
                    (p) =>
                      p.partId ||
                      p.id ||
                      p.partIdentity ||
                      `${p.name || "unknown"}-${p.partNumber || "no-number"}-${versionId}`
                  );

                  return (
                    <PartListElement
                      key={partKey}
                      part={part}
                      queryParams={queryParams}
                      matchingCard={matchingCard}
                      currentColumn={currentColumn}
                      isSelected={selectedPartKeys.has(partKey)}
                      onSelect={(e) =>
                        handlePartSelect(e, partKey, index, allPartKeys)
                      }
                      partKey={partKey}
                      index={index}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Bulk Release Dialog */}
        <BulkReleaseDialog
          open={bulkReleaseDialogOpen}
          onOpenChange={setBulkReleaseDialogOpen}
          selectedParts={selectedPartsInfo.eligibleParts}
          onSubmit={handleBulkRelease}
          isSubmitting={isBulkReleasing}
        />

        {/* Floating Bulk Release UI */}
        {selectedPartKeys.size > 0 && (
          <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 pb-8">
            <div className="bg-card border-border flex items-center gap-4 rounded-lg border px-4 py-3 shadow-lg">
              {selectedPartsInfo.allEligible ? (
                <>
                  <Button
                    onClick={() => setBulkReleaseDialogOpen(true)}
                    disabled={isBulkReleasing}
                  >
                    Release {selectedPartKeys.size} part
                    {selectedPartKeys.size !== 1 ? "s" : ""} to manufacturing
                  </Button>
                  {isBulkReleasing && (
                    <span className="text-muted-foreground text-sm">
                      Releasing parts...
                    </span>
                  )}
                </>
              ) : (
                <>
                  <AlertCircle className="text-destructive h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-medium">Some parts are not eligible</p>
                    <p className="text-muted-foreground text-sm">
                      {selectedPartsInfo.ineligibleParts.length} card
                      {selectedPartsInfo.ineligibleParts.length !== 1
                        ? "s"
                        : ""}{" "}
                      {selectedPartsInfo.ineligibleParts.length !== 1
                        ? "are"
                        : "is"}{" "}
                      not eligible for release. Ensure all selected parts have a
                      material, part number, and are not already in the
                      manufacturing tracker.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
