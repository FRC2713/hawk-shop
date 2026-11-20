import { Edit, MoreVertical, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { ProcessRow } from "~/server/db/types";
import { ProcessIcon } from "./ProcessIcon";

interface ProcessCardProps {
  process: ProcessRow;
  onEdit: () => void;
  onDelete: () => void;
}

/** A compact row below lg, a card in the desktop grid. */
export function ProcessCard({ process, onEdit, onDelete }: ProcessCardProps) {
  return (
    <div className="lg:bg-card lg:hover:border-primary/50 flex min-h-14 items-center gap-3 py-1.5 pr-1 pl-3 transition-colors lg:h-full lg:items-start lg:rounded-xl lg:border lg:p-4 lg:pr-2 lg:shadow-xs">
      <ProcessIcon process={process} className="size-5 shrink-0 lg:mt-0.5" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold lg:line-clamp-2 lg:text-base lg:leading-tight lg:whitespace-normal">
          {process.name}
        </h3>
        {process.description && (
          <p className="text-muted-foreground truncate text-xs lg:mt-1 lg:line-clamp-2 lg:text-sm lg:whitespace-normal">
            {process.description}
          </p>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 lg:-mt-1.5 lg:size-8"
          >
            <MoreVertical className="size-4" />
            <span className="sr-only">Open menu for {process.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              onEdit();
            }}
          >
            <Edit className="mr-2 size-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              onDelete();
            }}
            className="text-destructive"
          >
            <Trash2 className="mr-2 size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
