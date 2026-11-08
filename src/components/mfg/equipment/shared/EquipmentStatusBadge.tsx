import { CheckCircle2, Clock, Wrench, XCircle } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

export type EquipmentStatus =
  "available" | "in-use" | "maintenance" | "retired";

interface EquipmentStatusBadgeProps {
  status: EquipmentStatus | null | undefined;
  className?: string;
}

const statusConfig: Record<
  EquipmentStatus,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    className: string;
  }
> = {
  available: {
    label: "Available",
    icon: CheckCircle2,
    className: "bg-muted text-foreground border-border",
  },
  "in-use": {
    label: "In Use",
    icon: Clock,
    className: "bg-muted text-foreground border-border",
  },
  maintenance: {
    label: "Maintenance",
    icon: Wrench,
    className: "bg-muted text-foreground border-border",
  },
  retired: {
    label: "Retired",
    icon: XCircle,
    className: "bg-muted text-foreground border-border",
  },
};

export function EquipmentStatusBadge({
  status,
  className,
}: EquipmentStatusBadgeProps) {
  if (!status || !(status in statusConfig)) {
    return null;
  }

  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={cn("flex items-center gap-1.5", config.className, className)}
    >
      <Icon className="size-3" />
      <span>{config.label}</span>
    </Badge>
  );
}
