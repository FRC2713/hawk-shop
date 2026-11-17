import type { EquipmentWithProcesses } from "~/server/db/types";

export type MachineStatus = "needs-maintenance" | "running" | "idle";

export interface MachineWeeklyStats {
  done: number;
  sent_back: number;
}

/** Additive fields on GET /api/equipment; queue uses the machine queue rules. */
export type EquipmentListItem = EquipmentWithProcesses & {
  machine_status: MachineStatus;
  queue_size: number;
  weekly_stats: MachineWeeklyStats & { week_start: string; week_end: string };
  current_parts: { id: string; title: string }[];
};

export const machineStatusLabels: Record<MachineStatus, string> = {
  "needs-maintenance": "Needs maintenance",
  running: "Running",
  idle: "Idle",
};
