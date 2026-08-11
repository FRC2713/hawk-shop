import { Edit, ExternalLink, MoreVertical, Trash2, Eye } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { EquipmentRow } from "~/lib/db/types";

interface EquipmentActionsMenuProps {
  equipment: EquipmentRow;
  onEdit: () => void;
  onDelete: () => void;
  onViewDetails: () => void;
}

export function EquipmentActionsMenu({
  equipment,
  onEdit,
  onDelete,
  onViewDetails,
}: EquipmentActionsMenuProps) {
  return (
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
            onViewDetails();
          }}
        >
          <Eye className="mr-2 size-4" />
          View Details
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            onEdit();
          }}
        >
          <Edit className="mr-2 size-4" />
          Edit
        </DropdownMenuItem>
        {equipment.documentation_url && (
          <DropdownMenuItem asChild>
            <a
              href={equipment.documentation_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center"
            >
              <ExternalLink className="mr-2 size-4" />
              Documentation
            </a>
          </DropdownMenuItem>
        )}
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
  );
}
