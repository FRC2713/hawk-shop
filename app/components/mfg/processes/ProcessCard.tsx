import { Edit, MoreVertical, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { ProcessRow } from "~/lib/db/types";

interface ProcessCardProps {
  process: ProcessRow;
  onEdit: () => void;
  onDelete: () => void;
}

export function ProcessCard({ process, onEdit, onDelete }: ProcessCardProps) {
  return (
    <Card className="hover:border-primary/50 transition-all">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 flex-1 text-base leading-tight font-semibold">
            {process.name}
          </h3>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8">
                <MoreVertical className="size-4" />
                <span className="sr-only">Open menu</span>
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
      </CardHeader>
      {process.description && (
        <CardContent className="pt-0">
          <p className="text-muted-foreground line-clamp-2 text-sm">
            {process.description}
          </p>
        </CardContent>
      )}
    </Card>
  );
}
