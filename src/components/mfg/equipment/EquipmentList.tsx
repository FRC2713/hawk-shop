import { Image as ImageIcon, Wrench } from "lucide-react";
import type { EquipmentWithProcesses } from "~/lib/api";
import { machineStatusLabels, type EquipmentListItem } from "~/lib/equipment";

export type EquipmentGroupBy = "process" | "location" | "none";

interface EquipmentListProps {
  equipment: EquipmentListItem[];
  groupBy: EquipmentGroupBy;
}

interface Group {
  name: string;
  items: EquipmentListItem[];
}

function groupKey(item: EquipmentWithProcesses, groupBy: EquipmentGroupBy) {
  if (groupBy === "process") return item.processes?.[0]?.name ?? "No process";
  if (groupBy === "location") return item.location?.trim() || "No location";
  return "All equipment";
}

export function groupEquipment(
  equipment: EquipmentListItem[],
  groupBy: EquipmentGroupBy
): Group[] {
  const groups = new Map<string, EquipmentListItem[]>();
  for (const item of equipment) {
    const keys =
      groupBy === "process" && item.processes.length
        ? item.processes.map((process) => process.name)
        : [groupKey(item, groupBy)];
    for (const key of new Set(keys))
      groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const byName = (a: string, b: string) =>
    a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  return [...groups.entries()]
    .sort(([a], [b]) => byName(a, b))
    .map(([name, items]) => ({
      name,
      items: [...items].sort((a, b) => byName(a.name, b.name)),
    }));
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** Subtitle under a row: location, plus whatever the grouping hides. */
function rowDetail(item: EquipmentWithProcesses, groupBy: EquipmentGroupBy) {
  const location = item.location?.trim();
  const processes = (item.processes ?? []).map((p) => p.name);
  if (groupBy === "process") {
    return [location, processes.length > 1 ? processes.join(", ") : null]
      .filter(Boolean)
      .join(" · ");
  }
  if (groupBy === "location") return processes.join(", ");
  return [location, processes.join(", ")].filter(Boolean).join(" · ");
}

export function EquipmentList({ equipment, groupBy }: EquipmentListProps) {
  const groups = groupEquipment(equipment, groupBy);

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        return (
          <section
            key={group.name}
            aria-label={groupBy === "none" ? "Equipment" : group.name}
            className="bg-card overflow-hidden rounded-xl border shadow-xs"
          >
            {groupBy !== "none" && (
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
                <h2 className="text-base">{group.name}</h2>
                <span className="text-muted-foreground text-xs">
                  {plural(group.items.length, "machine", "machines")}
                </span>
              </div>
            )}
            <ul>
              {group.items.map((item) => {
                const count = item.queue_size;
                const cover = item.image_urls?.[0];
                const detail = rowDetail(item, groupBy);
                return (
                  <li key={item.id} className="border-t first:border-t-0">
                    <a
                      href={`/equipment/${encodeURIComponent(item.id)}`}
                      className="focus-visible:ring-ring/50 hover:bg-muted flex min-h-20 w-full flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
                    >
                      <span className="bg-muted flex h-[42px] w-14 shrink-0 items-center justify-center overflow-hidden rounded-sm border">
                        {cover ? (
                          <img
                            src={cover}
                            alt=""
                            className="size-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <ImageIcon
                            className="text-muted-foreground size-4"
                            aria-hidden="true"
                          />
                        )}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-semibold">
                          {item.name}
                        </span>
                        {detail && (
                          <span className="text-muted-foreground truncate text-xs">
                            {detail}
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1 text-xs">
                        <span className="flex items-center gap-1 font-semibold">
                          {item.machine_status === "needs-maintenance" && (
                            <Wrench className="size-4" aria-hidden="true" />
                          )}
                          {machineStatusLabels[item.machine_status]}
                        </span>
                        <span>
                          <span className="brand-figures">{count}</span> queued
                        </span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
