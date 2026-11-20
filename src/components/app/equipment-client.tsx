import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { ErrorDisplay } from "~/components/mfg/ErrorDisplay";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import {
  equipmentQuery,
  needsMaintenance,
  type EquipmentWithProcesses,
} from "~/lib/api";
import { cn } from "~/lib/utils";
import {
  EquipmentList,
  type EquipmentGroupBy,
} from "~/components/mfg/equipment/EquipmentList";
import { EquipmentTable } from "~/components/mfg/equipment/EquipmentTable";
import { ProcessesSection } from "~/components/mfg/processes/ProcessesSection";

type Filter = "all" | "maintenance" | "no-photo";

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
  const { data: equipment = [], isLoading, error } = useQuery(equipmentQuery());

  const maintenanceCount = equipment.filter(needsMaintenance).length;
  const query = search.trim().toLowerCase();
  const visible = equipment.filter(
    (item) =>
      (filter === "all" ||
        (filter === "maintenance"
          ? needsMaintenance(item)
          : !item.image_urls?.length)) &&
      (!query || matches(item, query))
  );

  if (error) return <ErrorDisplay error={error} />;

  const tabs: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: equipment.length },
    {
      id: "maintenance",
      label: "Needs maintenance",
      count: maintenanceCount,
    },
    {
      id: "no-photo",
      label: "No photo",
      count: equipment.filter((item) => !item.image_urls?.length).length,
    },
  ];

  return (
    <div className="h-full min-h-0 min-w-0 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 pt-6 pb-28">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl leading-9">Equipment</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <a href="/station">Open station screen</a>
            </Button>
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
            <Button
              asChild
              className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 min-h-12 shadow-lg lg:static lg:shadow-none"
            >
              <a href="/equipment/new">
                <Plus aria-hidden="true" />
                Add equipment
              </a>
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
          <label className="ml-auto hidden items-center gap-2 py-1 lg:flex">
            <span className="text-muted-foreground text-sm">Group by</span>
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
                      : filter === "no-photo" && !query
                        ? "Every machine has a photo"
                        : "No equipment matches"}
                </h2>
                <p className="text-muted-foreground text-sm">
                  {equipment.length === 0
                    ? "Add the machines and tools in your shop so parts can be assigned to them."
                    : filter === "maintenance" && !query
                      ? "Flagged equipment shows up here."
                      : filter === "no-photo" && !query
                        ? "Choose All to browse your equipment."
                        : "Try a different search or filter."}
                </p>
                {equipment.length === 0 && (
                  <Button asChild>
                    <a href="/equipment/new">
                      <Plus aria-hidden="true" />
                      Add equipment
                    </a>
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div className="lg:hidden">
                  <EquipmentList equipment={visible} groupBy="process" />
                </div>
                <div className="hidden min-w-0 lg:block">
                  <EquipmentTable equipment={visible} groupBy={groupBy} />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="mt-8">
          <ProcessesSection />
        </div>
      </div>
    </div>
  );
}
