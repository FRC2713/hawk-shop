import { ChevronDownIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { KanbanColumn } from "~/lib/kanbanApi/columnTypes";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";
import type { KanbanCardRow } from "~/lib/db/types";
import { cn } from "~/lib/utils";
import type { PartsPageSearchParams } from "~/onshape_connector/page";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { ManufacturingStateBadge } from "./ManufacturingStateBadge";
import { PartCardThumbnail } from "./PartCardThumbnail";
import { PartMfgState } from "./PartMfgState";
import { PartNumberInput } from "./PartNumberInput";

interface PartCardProps {
  part: BtPartMetadataInfo;
  queryParams: PartsPageSearchParams;
  matchingCard?: KanbanCardRow;
  currentColumn?: KanbanColumn;
  isSelected?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
  partKey?: string;
  index?: number;
}

/**
 * Component to display a single part with thumbnail error handling
 */
export function PartCard({
  part,
  queryParams,
  matchingCard,
  currentColumn,
  isSelected = false,
  onSelect,
  partKey,
  index,
}: PartCardProps) {
  // Extract thumbnail URL once (memoized to avoid recalculation)
  const thumbnailUrl = useMemo(() => {
    return (
      part.thumbnailInfo?.sizes?.find((s) => s.size === "300x300")?.href ||
      part.thumbnailInfo?.sizes?.[0]?.href ||
      part.thumbnailInfo?.sizes?.find((s) => s.size === "600x340")?.href
    );
  }, [part.thumbnailInfo?.sizes]);

  // Extract onshape params only if documentId exists (memoized)
  const onshapeParams = useMemo(() => {
    if (!queryParams.documentId) return undefined;
    return {
      documentId: queryParams.documentId,
      instanceType: queryParams.instanceType,
      instanceId: queryParams.instanceId || "",
      elementId: queryParams.elementId || "",
    };
  }, [
    queryParams.documentId,
    queryParams.instanceType,
    queryParams.instanceId,
    queryParams.elementId,
  ]);

  // Early return if no part number (PartMfgState won't render anything anyway)
  const partId = part.partId || part.id || "";
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <Card className="transition-shadow hover:shadow-lg">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-1 items-start gap-2">
            {/* Checkbox - Top left */}
            {onSelect && (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onSelect(e);
                }}
                onMouseDown={(e) => {
                  // Prevent other interactions when clicking checkbox
                  e.stopPropagation();
                }}
                onPointerDown={(e) => {
                  // Prevent other interactions when clicking checkbox
                  e.stopPropagation();
                }}
                className="z-10 mt-0.5 flex cursor-pointer items-center"
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => {
                    // Handled by onClick above
                  }}
                  className="border-foreground/40 dark:border-foreground/60 bg-background/80 dark:bg-background/60 pointer-events-none shadow-sm"
                />
              </div>
            )}
            <div className="flex flex-col flex-wrap items-start gap-2">
              <CardTitle className="text-lg">
                {part.name || `Part ${partId || "Unknown"}`}
              </CardTitle>
              {part.partNumber && (
                <span className="text-muted-foreground font-mono text-sm">
                  {part.partNumber || "No P/N"}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-start gap-2">
            {matchingCard && currentColumn && (
              <ManufacturingStateBadge column={currentColumn} />
            )}
            {part.isHidden && <Badge variant="secondary">Hidden</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <PartCardThumbnail part={part} />
        {part.partNumber ? (
          <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <CollapsibleTrigger className="w-full">
              <div className="flex w-full flex-row flex-wrap items-center justify-between gap-2">
                <span>Part Details</span>
                <ChevronDownIcon
                  className={cn("h-4 w-4", isExpanded && "rotate-180")}
                />
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <PartMfgState
                partNumber={part.partNumber}
                partId={partId}
                part={part}
                thumbnailUrl={thumbnailUrl}
                onshapeParams={onshapeParams}
                matchingCard={matchingCard}
                currentColumn={currentColumn}
                queryParams={queryParams}
              />
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <PartNumberInput part={part} queryParams={queryParams} />
        )}
      </CardContent>
    </Card>
  );
}
