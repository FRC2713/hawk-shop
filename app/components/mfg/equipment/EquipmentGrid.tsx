import type { EquipmentRow } from "~/lib/db/types";
import { EquipmentCard } from "./EquipmentCard";
import { EquipmentCardSkeleton } from "./EquipmentCardSkeleton";
import { EquipmentEmptyState } from "./EquipmentEmptyState";

interface EquipmentGridProps {
  equipment: EquipmentRow[];
  loading: boolean;
  onEquipmentClick: (equipment: EquipmentRow) => void;
  onEdit: (equipment: EquipmentRow) => void;
  onDelete: (equipment: EquipmentRow) => void;
  onViewDetails: (equipment: EquipmentRow) => void;
  onAddClick: () => void;
}

export function EquipmentGrid({
  equipment,
  loading,
  onEquipmentClick,
  onEdit,
  onDelete,
  onViewDetails,
  onAddClick,
}: EquipmentGridProps) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <EquipmentCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (equipment.length === 0) {
    return <EquipmentEmptyState onAddClick={onAddClick} />;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {equipment.map((item) => (
        <EquipmentCard
          key={item.id}
          equipment={item}
          onClick={() => onEquipmentClick(item)}
          onEdit={() => onEdit(item)}
          onDelete={() => onDelete(item)}
          onViewDetails={() => onViewDetails(item)}
        />
      ))}
    </div>
  );
}
