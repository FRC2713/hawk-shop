import { Workflow } from "./Workflow";
import { EquipmentEditor as Editor } from "~/components/mfg/equipment/EquipmentEditor";
import type { EquipmentWithProcesses } from "~/lib/api";

/** The route and dialog use the same editor and API mutations. */
export default function EquipmentEditor({
  equipment,
  allEquipment,
}: {
  equipment?: EquipmentWithProcesses;
  allEquipment: EquipmentWithProcesses[];
}) {
  return (
    <Workflow>
      <div className="h-full overflow-y-auto px-4 py-6 sm:px-6">
        <Editor
          equipment={equipment}
          allEquipment={allEquipment}
          onCancel={() => window.location.assign("/equipment")}
          onSaved={() => window.location.assign("/equipment")}
        />
      </div>
    </Workflow>
  );
}
