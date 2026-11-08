import { Wrench } from "lucide-react";
import { Button } from "~/components/ui/button";

interface EquipmentEmptyStateProps {
  onAddClick: () => void;
}

export function EquipmentEmptyState({ onAddClick }: EquipmentEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
      <div className="bg-primary/10 mb-4 flex size-16 items-center justify-center rounded-full">
        <Wrench className="text-primary size-8" />
      </div>
      <h3 className="mb-2 text-lg font-semibold">No equipment yet</h3>
      <p className="text-muted-foreground mb-6 max-w-sm text-sm">
        Get started by adding your first piece of equipment to track in your FRC
        shop.
      </p>
      <Button onClick={onAddClick}>
        <Wrench className="mr-2 size-4" />
        Add Equipment
      </Button>
    </div>
  );
}
