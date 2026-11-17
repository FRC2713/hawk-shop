import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

export type FilterOption = { id: string; name: string; icon?: ReactNode };
export type FilterOptionGroup = { label?: string; options: FilterOption[] };

/**
 * A labelled multi-select filter. The trigger names the filter and what it
 * is set to: "Process: All", "Process: CNC Milling", "Process: 2 selected".
 */
export function FilterMenu({
  label,
  groups,
  selectedIds,
  onChange,
  emptyText = "Nothing to filter by",
}: {
  label: string;
  groups: FilterOptionGroup[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const options = groups.flatMap((group) => group.options);
  const summary =
    selectedIds.length === 0
      ? "All"
      : selectedIds.length === 1
        ? (options.find((option) => option.id === selectedIds[0])?.name ??
          "1 selected")
        : `${selectedIds.length} selected`;
  const toggle = (id: string) =>
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((selected) => selected !== id)
        : [...selectedIds, id]
    );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant={selectedIds.length > 0 ? "secondary" : "outline"}
          size="sm"
          className="max-w-64 gap-1"
        >
          <span className="text-muted-foreground">{label}:</span>{" "}
          <span className="truncate">{summary}</span>
          <ChevronDown className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-96 w-60 overflow-auto"
      >
        {selectedIds.length > 0 && (
          <>
            <DropdownMenuItem onClick={() => onChange([])}>
              Show all
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {options.length === 0 && (
          <div className="text-muted-foreground px-2 py-1.5 text-sm">
            {emptyText}
          </div>
        )}
        {groups.map((group, index) =>
          group.options.length === 0 ? null : (
            <div key={group.label ?? index}>
              {index > 0 && <DropdownMenuSeparator />}
              {group.label && (
                <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                  {group.label}
                </DropdownMenuLabel>
              )}
              {group.options.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.id}
                  checked={selectedIds.includes(option.id)}
                  onCheckedChange={() => toggle(option.id)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {option.icon}
                  <span className="truncate">{option.name}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </div>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
