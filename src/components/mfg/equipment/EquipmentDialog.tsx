import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import { EquipmentEditor } from "./EquipmentEditor";
import type { EquipmentWithProcesses } from "~/lib/api";

/** Compatibility wrapper for workflows that still open an equipment dialog. */
export function EquipmentDialog({
  open,
  onOpenChange,
  equipment,
  allEquipment,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  equipment?: EquipmentWithProcesses | null;
  allEquipment: EquipmentWithProcesses[];
  onSaved?: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto p-0 sm:max-w-3xl">
        <DialogTitle className="sr-only">
          {equipment ? "Edit equipment" : "Add equipment"}
        </DialogTitle>
        <EquipmentEditor
          equipment={equipment}
          allEquipment={allEquipment}
          defaultAddAnother
          onCancel={() => onOpenChange(false)}
          onSaved={(id) => {
            onSaved?.(id);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
