import { MapPin } from "lucide-react";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import type { EquipmentRow, ProcessRow } from "~/lib/db/types";
import { EquipmentProcessChip } from "./shared/EquipmentCategoryChip";
import { EquipmentImage } from "./shared/EquipmentImage";
import { EquipmentStatusBadge } from "./shared/EquipmentStatusBadge";
import { EquipmentActionsMenu } from "./shared/EquipmentActionsMenu";

interface EquipmentCardProps {
  equipment: EquipmentRow & { processes?: ProcessRow[] };
  onEdit: () => void;
  onDelete: () => void;
  onViewDetails: () => void;
  onClick?: () => void;
}

export function EquipmentCard({
  equipment,
  onEdit,
  onDelete,
  onViewDetails,
  onClick,
}: EquipmentCardProps) {
  const firstImageUrl = Array.isArray(equipment.image_urls)
    ? equipment.image_urls[0]
    : null;

  return (
    <Card
      className="group hover:border-primary cursor-pointer transition-all duration-200 hover:shadow-md"
      onClick={onClick}
    >
      <EquipmentImage
        imageUrl={firstImageUrl}
        alt={equipment.name}
        size="thumbnail"
      />
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 flex-1 text-lg leading-tight font-semibold">
            {equipment.name}
          </h3>
          <div onClick={(e) => e.stopPropagation()}>
            <EquipmentActionsMenu
              equipment={equipment}
              onEdit={onEdit}
              onDelete={onDelete}
              onViewDetails={onViewDetails}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {equipment.processes && equipment.processes.length > 0 && (
            <>
              {equipment.processes.map((process) => (
                <EquipmentProcessChip key={process.id} process={process} />
              ))}
            </>
          )}
          <EquipmentStatusBadge
            status={
              equipment.status as
                "available" | "in-use" | "maintenance" | "retired" | null
            }
          />
        </div>
        {equipment.location && (
          <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <MapPin className="size-4" />
            <span>{equipment.location}</span>
          </div>
        )}
        {equipment.description && (
          <p className="text-muted-foreground line-clamp-2 text-sm">
            {equipment.description}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
