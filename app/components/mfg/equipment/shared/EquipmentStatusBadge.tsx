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
    className:
      "bg-green-500/10 text-green-700 border-green-500/20 dark:text-green-400 dark:bg-green-500/20",
  },
  "in-use": {
    label: "In Use",
    icon: Clock,
    className:
      "bg-yellow-500/10 text-yellow-700 border-yellow-500/20 dark:text-yellow-400 dark:bg-yellow-500/20",
  },
  maintenance: {
    label: "Maintenance",
    icon: Wrench,
    className:
      "bg-orange-500/10 text-orange-700 border-orange-500/20 dark:text-orange-400 dark:bg-orange-500/20",
  },
  retired: {
    label: "Retired",
    icon: XCircle,
    className:
      "bg-gray-500/10 text-gray-700 border-gray-500/20 dark:text-gray-400 dark:bg-gray-500/20",
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
