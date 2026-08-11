import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";
import type { ProcessRow } from "~/lib/db/types";

interface EquipmentProcessChipProps {
  process: ProcessRow;
  className?: string;
}

export function EquipmentProcessChip({
  process,
  className,
}: EquipmentProcessChipProps) {
  return (
    <Badge variant="secondary" className={cn("font-normal", className)}>
      {process.name}
    </Badge>
  );
}
