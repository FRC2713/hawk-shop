import {
  Search,
  ArrowUpDown,
  RefreshCw,
  X,
  ArrowUp,
  ArrowDown,
  LayoutGrid,
  List,
} from "lucide-react";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Label } from "~/components/ui/label";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { cn } from "~/lib/utils";
import { Separator } from "~/components/ui/separator";
import type { SortBy, SortDirection } from "./hooks/usePartsSort";

// Re-export types for convenience
export type { SortBy, SortDirection };

interface OnshapeConnectorToolbarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  sortBy: SortBy;
  onSortByChange: (value: SortBy) => void;
  sortDirection: SortDirection;
  onSortDirectionChange: (direction: SortDirection) => void;
  onRefresh: () => void;
  isFetching: boolean;
  resultCount?: number;
  totalCount?: number;
  isSearching?: boolean;
  viewMode?: "cards" | "list";
  onViewModeChange?: (mode: "cards" | "list") => void;
  hideReleased?: boolean;
  onHideReleasedChange?: (value: boolean) => void;
}

export function OnshapeConnectorToolbar({
  searchQuery,
  onSearchChange,
  sortBy,
  onSortByChange,
  sortDirection,
  onSortDirectionChange,
  onRefresh,
  isFetching,
  resultCount,
  totalCount,
  isSearching = false,
  viewMode = "cards",
  onViewModeChange,
  hideReleased = false,
  onHideReleasedChange,
}: OnshapeConnectorToolbarProps) {
  const handleSortDirectionToggle = () => {
    onSortDirectionChange(sortDirection === "asc" ? "desc" : "asc");
  };

  const handleClearSearch = () => {
    onSearchChange("");
  };

  const sortLabel =
    sortBy !== "none" ? (
      <span className="text-muted-foreground text-xs">
        {sortBy === "name" && "Name"}
        {sortBy === "partNumber" && "Part Number"}
        {sortBy === "material" && "Material"}
        {sortBy === "mfgState" && "Mfg State"}
        {sortBy === "createdAt" && "Created"}
        {sortBy === "updatedAt" && "Updated"}{" "}
        {sortDirection === "asc" ? (
          <ArrowUp className="inline h-3 w-3" />
        ) : (
          <ArrowDown className="inline h-3 w-3" />
        )}
      </span>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            type="text"
            placeholder="Search parts..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pr-10 pl-10"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1/2 right-1 h-6 w-6 -translate-y-1/2"
              onClick={handleClearSearch}
              title="Clear search"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        <div className="flex items-end gap-2">
          <div className="w-full space-y-2 sm:w-[200px]">
            <Select
              value={sortBy}
              onValueChange={(value) => onSortByChange(value as SortBy)}
            >
              <SelectTrigger id="sort-select">
                <SelectValue placeholder="No sorting" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No sorting</SelectItem>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="partNumber">Part Number</SelectItem>
                <SelectItem value="material">Material</SelectItem>
                <SelectItem value="mfgState">Manufacturing State</SelectItem>
                <SelectItem value="createdAt">Date Created</SelectItem>
                <SelectItem value="updatedAt">Last Updated</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {sortBy !== "none" && (
            <Button
              variant="outline"
              size="icon"
              onClick={handleSortDirectionToggle}
              title={`Sort ${sortDirection === "asc" ? "ascending" : "descending"}`}
              className="h-10 w-10"
            >
              <ArrowUpDown className="h-4 w-4" />
            </Button>
          )}
          {onViewModeChange && (
            <Button
              variant="outline"
              size="icon"
              onClick={() =>
                onViewModeChange(viewMode === "cards" ? "list" : "cards")
              }
              title={`Switch to ${viewMode === "cards" ? "list" : "cards"} view`}
              className="h-10 w-10"
            >
              {viewMode === "cards" ? (
                <List className="h-4 w-4" />
              ) : (
                <LayoutGrid className="h-4 w-4" />
              )}
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={onRefresh}
            title="Refresh data"
            className="h-10 w-10"
            disabled={isFetching}
          >
            <RefreshCw
              className={cn("h-4 w-4", isFetching && "animate-spin")}
            />
          </Button>
        </div>
      </div>
      {(resultCount !== undefined ||
        isSearching ||
        sortLabel ||
        onHideReleasedChange) && (
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {isSearching && (
            <span className="text-muted-foreground text-xs">Searching...</span>
          )}
          {resultCount !== undefined && totalCount !== undefined && (
            <span className="text-muted-foreground text-xs">
              {resultCount === totalCount
                ? `${totalCount} part${totalCount !== 1 ? "s" : ""}`
                : `${resultCount} of ${totalCount} part${totalCount !== 1 ? "s" : ""}`}
            </span>
          )}
          {sortLabel}
          {onHideReleasedChange && (
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                checked={hideReleased}
                onCheckedChange={(checked) =>
                  onHideReleasedChange(checked === true)
                }
              />
              <span className="text-muted-foreground">Hide released parts</span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
