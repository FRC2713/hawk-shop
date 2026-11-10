import { Image as ImageIcon, Wrench } from "lucide-react";
import { needsMaintenance, type EquipmentWithProcesses } from "~/lib/api";
import { cn } from "~/lib/utils";

export type EquipmentGroupBy = "process" | "location" | "none";

interface EquipmentListProps {
  equipment: EquipmentWithProcesses[];
  groupBy: EquipmentGroupBy;
  selectedId: string | null;
  assignedCounts: Map<string, number>;
  onSelect: (item: EquipmentWithProcesses) => void;
}

interface Group {
  name: string;
  items: EquipmentWithProcesses[];
}

function groupKey(item: EquipmentWithProcesses, groupBy: EquipmentGroupBy) {
  if (groupBy === "process") return item.processes?.[0]?.name ?? "No process";
  if (groupBy === "location") return item.location?.trim() || "No location";
  return "All equipment";
}

function groupEquipment(
  equipment: EquipmentWithProcesses[],
  groupBy: EquipmentGroupBy
): Group[] {
  const groups = new Map<string, EquipmentWithProcesses[]>();
  for (const item of equipment) {
    const key = groupKey(item, groupBy);
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
    const others = processes.slice(1);
    return [location, others.length ? `also ${others.join(", ")}` : null]
      .filter(Boolean)
      .join(" · ");
  }
  if (groupBy === "location") return processes.join(", ");
  return [location, processes.join(", ")].filter(Boolean).join(" · ");
}

export function EquipmentList({
  equipment,
  groupBy,
  selectedId,
  assignedCounts,
  onSelect,
}: EquipmentListProps) {
  const groups = groupEquipment(equipment, groupBy);

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        const parts = group.items.reduce(
          (sum, item) => sum + (assignedCounts.get(item.id) ?? 0),
          0
        );
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
                  {plural(group.items.length, "item", "items")} ·{" "}
                  {plural(parts, "part", "parts")} assigned
                </span>
              </div>
            )}
            <ul>
              {group.items.map((item) => {
                const selected = item.id === selectedId;
                const count = assignedCounts.get(item.id) ?? 0;
                const cover = item.image_urls?.[0];
                const detail = rowDetail(item, groupBy);
                return (
                  <li key={item.id} className="border-t first:border-t-0">
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onSelect(item)}
                      className={cn(
                        "focus-visible:ring-ring/50 flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-inset",
                        selected
                          ? "bg-muted shadow-[inset_4px_0_0_var(--primary)]"
                          : "hover:bg-muted"
                      )}
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
                      <span className="flex min-w-0 flex-[1_1_180px] flex-col">
                        <span className="truncate font-semibold">
                          {item.name}
                        </span>
                        {detail && (
                          <span className="text-muted-foreground truncate text-xs">
                            {detail}
                          </span>
                        )}
                      </span>
                      <span className="flex min-h-5 flex-[0_0_160px] items-center gap-1.5 text-xs font-semibold text-[var(--emphasis)]">
                        {needsMaintenance(item) && (
                          <>
                            <Wrench className="size-4" aria-hidden="true" />
                            Needs maintenance
                          </>
                        )}
                      </span>
                      <span className="flex-[0_0_96px] text-right text-xs">
                        <span className="brand-figures text-[13px] font-bold">
                          {count}
                        </span>{" "}
                        {count === 1 ? "part" : "parts"}
                      </span>
                    </button>
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
