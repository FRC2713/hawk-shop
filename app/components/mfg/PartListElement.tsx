import { useMemo, useState } from "react";
import Image from "next/image";
import { Badge } from "~/components/ui/badge";
import { Checkbox } from "~/components/ui/checkbox";
import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";
import type { KanbanCardRow } from "~/lib/db/types";
import type { KanbanColumn } from "~/lib/kanbanApi/columnTypes";
import type { PartsPageSearchParams } from "~/onshape_connector/page";
import { ManufacturingStateBadge } from "./ManufacturingStateBadge";
import { cn } from "~/lib/utils";

interface PartListElementProps {
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
 * Small thumbnail component for list view
 */
function PartListThumbnail({ part }: { part: BtPartMetadataInfo }) {
  const rawThumbnailUrl =
    part.thumbnailInfo?.sizes?.find((s) => s.size === "300x300")?.href ||
    part.thumbnailInfo?.sizes?.[0]?.href ||
    part.thumbnailInfo?.sizes?.find((s) => s.size === "600x340")?.href;

  const thumbnailHref = rawThumbnailUrl
    ? `/api/onshape/thumbnail?url=${encodeURIComponent(rawThumbnailUrl)}`
    : null;

  const [thumbnailError, setThumbnailError] = useState(false);

  if (!thumbnailHref || thumbnailError) {
    return (
      <div className="bg-muted flex h-16 w-16 shrink-0 items-center justify-center rounded border">
        <span className="text-muted-foreground text-xs">No image</span>
      </div>
    );
  }

  return (
    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded border">
      <Image
        src={thumbnailHref}
        alt={`Thumbnail for ${part.name || part.partId || part.id || "part"}`}
        fill
        className="object-contain"
        onError={() => setThumbnailError(true)}
        unoptimized
      />
    </div>
  );
}

/**
 * Component to display a single part in list view format
 */
export function PartListElement({
  part,
  queryParams,
  matchingCard,
  currentColumn,
  isSelected = false,
  onSelect,
  partKey,
  index,
}: PartListElementProps) {
  const partId = part.partId || part.id || "";

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border p-3 transition-colors",
        isSelected && "bg-accent",
        "hover:bg-accent/50"
      )}
    >
      {/* Checkbox - First */}
      {onSelect && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onSelect(e);
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          className="flex shrink-0 cursor-pointer items-center"
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

      {/* Thumbnail - Second */}
      <PartListThumbnail part={part} />

      {/* Name and Part Number - Third */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="truncate font-medium">
          {part.name || `Part ${partId || "Unknown"}`}
        </div>
        {part.partNumber && (
          <span className="text-muted-foreground font-mono text-xs">
            {part.partNumber}
          </span>
        )}
      </div>

      {/* Status Badge - Right aligned */}
      <div className="flex shrink-0 items-center gap-2">
        {matchingCard && currentColumn && (
          <ManufacturingStateBadge column={currentColumn} />
        )}
        {part.isHidden && <Badge variant="secondary">Hidden</Badge>}
      </div>
    </div>
  );
}
