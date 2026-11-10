import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { ErrorDisplay } from "~/components/mfg/ErrorDisplay";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import {
  equipmentQuery,
  kanbanCardsQuery,
  kanbanConfigQuery,
  needsMaintenance,
  type EquipmentWithProcesses,
  type KanbanCardWithProcesses,
} from "~/lib/api";
import { cn } from "~/lib/utils";
import {
  EquipmentList,
  type EquipmentGroupBy,
} from "~/components/mfg/equipment/EquipmentList";
import { EquipmentDetailPanel } from "~/components/mfg/equipment/EquipmentDetailPanel";
import { EquipmentDialog } from "~/components/mfg/equipment/EquipmentDialog";
import { DeleteEquipmentDialog } from "~/components/mfg/equipment/DeleteEquipmentDialog";
import { ProcessesSection } from "~/components/mfg/processes/ProcessesSection";

type Filter = "all" | "maintenance";

function matches(item: EquipmentWithProcesses, query: string) {
  const haystack = [
    item.name,
    item.location,
    item.description,
    item.maintenance_note,
    ...(item.processes ?? []).map((p) => p.name),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export function EquipmentClient() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [groupBy, setGroupBy] = useState<EquipmentGroupBy>("process");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"add" | "edit" | "delete" | null>(null);
  const detailRef = useRef<HTMLElement>(null);

  const { data: equipment = [], isLoading, error } = useQuery(equipmentQuery());
  const { data: cards = [] } = useQuery(kanbanCardsQuery());
  const { data: config } = useQuery(kanbanConfigQuery());

  const columns = config?.columns ?? [];
  const doneId = columns.at(-1)?.id;
  const columnTitles = useMemo(
    () => new Map(columns.map((column) => [column.id, column.title])),
    [columns]
  );

  // Cards name their equipment by text; finished cards no longer need it.
  const cardsByEquipment = useMemo(() => {
    const byName = new Map<string, KanbanCardWithProcesses[]>();
    for (const card of cards) {
      if (!card.machine || card.column_id === doneId) continue;
      byName.set(card.machine, [...(byName.get(card.machine) ?? []), card]);
    }
    const byId = new Map<string, KanbanCardWithProcesses[]>();
    for (const item of equipment) {
      const assigned = (byName.get(item.name) ?? []).sort((a, b) =>
        (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")
      );
      byId.set(item.id, assigned);
    }
    return byId;
  }, [cards, equipment, doneId]);

  const assignedCounts = useMemo(
    () =>
      new Map(
        [...cardsByEquipment.entries()].map(([id, list]) => [id, list.length])
      ),
    [cardsByEquipment]
  );

  const maintenanceCount = equipment.filter(needsMaintenance).length;
  const query = search.trim().toLowerCase();
  const visible = equipment.filter(
    (item) =>
      (filter === "all" || needsMaintenance(item)) &&
      (!query || matches(item, query))
  );

  const selected = equipment.find((item) => item.id === selectedId) ?? null;

  // Keep a selection while there is equipment to show.
  useEffect(() => {
    if (isLoading) return;
    if (!selected && equipment.length > 0) {
      const first = [...equipment].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
      )[0];
      setSelectedId(first.id);
    }
  }, [equipment, isLoading, selected]);

  const select = (item: EquipmentWithProcesses) => {
    setSelectedId(item.id);
    // On a phone the panel sits below the list.
    if (window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() =>
        detailRef.current?.scrollIntoView({ behavior: "smooth" })
      );
    }
  };

  if (error) return <ErrorDisplay error={error} />;

  const tabs: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: equipment.length },
    {
      id: "maintenance",
      label: "Needs maintenance",
      count: maintenanceCount,
    },
  ];

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl leading-9">Equipment</h1>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <Input
                type="search"
                aria-label="Search equipment"
                placeholder="Search equipment..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="bg-card pl-9"
              />
            </div>
            <Button type="button" onClick={() => setDialog("add")}>
              <Plus aria-hidden="true" />
              Add equipment
            </Button>
          </div>
        </div>

        <div className="bg-card flex flex-wrap items-center gap-1 rounded-md border px-2">
          <div role="group" aria-label="Show" className="flex flex-wrap gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={filter === tab.id}
                onClick={() => setFilter(tab.id)}
                className={cn(
                  "focus-visible:ring-ring/50 flex min-h-11 items-center gap-1.5 px-3 text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-inset",
                  filter === tab.id
                    ? "text-[var(--link)] shadow-[inset_0_-3px_0_var(--primary)]"
                    : "hover:bg-muted"
                )}
              >
                {tab.label}
                <span className="brand-figures text-[13px]">{tab.count}</span>
              </button>
            ))}
          </div>
          <label className="ml-auto flex items-center gap-2 py-1">
            <span className="text-xs font-semibold">Group by</span>
            <select
              value={groupBy}
              onChange={(event) =>
                setGroupBy(event.target.value as EquipmentGroupBy)
              }
              className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/50 h-8 rounded-md border px-2 font-sans text-sm outline-none focus-visible:ring-[3px]"
            >
              <option value="process">Process</option>
              <option value="location">Location</option>
              <option value="none">None</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-start gap-4">
          <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
            {isLoading ? (
              <div className="bg-card flex flex-col gap-3 rounded-xl border p-4">
                {Array.from({ length: 5 }, (_, index) => (
                  <Skeleton key={index} className="h-11 w-full" />
                ))}
              </div>
            ) : visible.length === 0 ? (
              <div className="bg-card flex flex-col items-center gap-2 rounded-xl border p-6 text-center">
                <h2 className="text-base">
                  {equipment.length === 0
                    ? "No equipment yet"
                    : filter === "maintenance" && !query
                      ? "Nothing needs maintenance"
                      : "No equipment matches"}
                </h2>
                <p className="text-muted-foreground text-sm">
                  {equipment.length === 0
                    ? "Add the machines and tools in your shop so parts can be assigned to them."
                    : filter === "maintenance" && !query
                      ? "Flagged equipment shows up here."
                      : "Try a different search."}
                </p>
                {equipment.length === 0 && (
                  <Button type="button" onClick={() => setDialog("add")}>
                    <Plus aria-hidden="true" />
                    Add equipment
                  </Button>
                )}
              </div>
            ) : (
              <EquipmentList
                equipment={visible}
                groupBy={groupBy}
                selectedId={selectedId}
                assignedCounts={assignedCounts}
                onSelect={select}
              />
            )}
          </div>

          {selected && (
            <aside
              ref={detailRef}
              aria-label={`${selected.name} details`}
              className="bg-card min-w-0 flex-[1_1_360px] scroll-mt-4 overflow-hidden rounded-xl border shadow-xs lg:sticky lg:top-6"
            >
              <EquipmentDetailPanel
                key={selected.id}
                equipment={selected}
                assignedCards={cardsByEquipment.get(selected.id) ?? []}
                columnTitles={columnTitles}
                onEdit={() => setDialog("edit")}
                onDelete={() => setDialog("delete")}
              />
            </aside>
          )}
        </div>

        <div className="mt-8">
          <ProcessesSection />
        </div>
      </div>

      <EquipmentDialog
        open={dialog === "add" || dialog === "edit"}
        onOpenChange={(open) => !open && setDialog(null)}
        equipment={dialog === "edit" ? selected : null}
        allEquipment={equipment}
        onSaved={(id) => setSelectedId(id)}
      />

      <DeleteEquipmentDialog
        open={dialog === "delete"}
        onOpenChange={(open) => !open && setDialog(null)}
        equipment={selected}
        assignedCount={selected ? (assignedCounts.get(selected.id) ?? 0) : 0}
        onDeleted={() => setSelectedId(null)}
      />
    </div>
  );
}
