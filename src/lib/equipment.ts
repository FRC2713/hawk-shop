import type { EquipmentWithProcesses } from "~/server/db/types";

export type MachineStatus = "needs-maintenance" | "running" | "idle";

/** Additive fields on GET /api/equipment; queue uses the machine queue rules. */
export type EquipmentListItem = EquipmentWithProcesses & {
  machine_status: MachineStatus;
  queue_size: number;
};

export const machineStatusLabels: Record<MachineStatus, string> = {
  "needs-maintenance": "Needs maintenance",
  running: "Running",
  idle: "Idle",
};
