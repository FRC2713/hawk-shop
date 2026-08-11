import { createFileRoute } from "@tanstack/react-router";
import { EquipmentClient } from "~/components/app/equipment-client";

export const Route = createFileRoute("/_main/equipment")({
  component: EquipmentPage,
});

function EquipmentPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <EquipmentClient />
    </div>
  );
}
