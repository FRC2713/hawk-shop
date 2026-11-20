import { ChevronLeft } from "lucide-react";
import { Workflow } from "./Workflow";
import { EquipmentEditor as Editor } from "~/components/mfg/equipment/EquipmentEditor";
import type { EquipmentWithProcesses } from "~/lib/api";

/** The add and edit routes share the editor and API mutations. */
export default function EquipmentEditor({
  equipment,
  allEquipment,
}: {
  equipment?: EquipmentWithProcesses;
  allEquipment: EquipmentWithProcesses[];
}) {
  return (
    <Workflow>
      <div className="h-full overflow-y-auto pt-4 pb-6">
        <div className="mx-auto w-full max-w-6xl px-5">
          <div className="mb-2 w-full max-w-3xl">
            <a
              href={
                equipment
                  ? `/equipment/${encodeURIComponent(equipment.id)}`
                  : "/equipment"
              }
              className="text-muted-foreground focus-visible:ring-ring/50 -ml-1 inline-flex min-h-11 max-w-full items-center gap-1 rounded-md pr-2 text-sm font-semibold outline-none hover:text-[var(--link)] focus-visible:ring-[3px]"
            >
              <ChevronLeft className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {equipment ? `Back to ${equipment.name}` : "Back to equipment"}
              </span>
            </a>
          </div>
          <Editor
            equipment={equipment}
            allEquipment={allEquipment}
            onCancel={() => window.location.assign("/equipment")}
            onSaved={() => window.location.assign("/equipment")}
          />
        </div>
      </div>
    </Workflow>
  );
}
