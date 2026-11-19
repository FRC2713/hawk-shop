import { ExternalLink } from "lucide-react";
import type { EquipmentListItem } from "~/lib/equipment";
import { groupEquipment, type EquipmentGroupBy } from "./EquipmentList";
import { MachineStatusPill } from "./MachineStatusPill";

/* One colgroup for every group's table, so columns line up across groups. */
const columns = [
  { heading: "Machine", width: "24%" },
  { heading: "Status", width: "16%" },
  { heading: "Current part", width: "28%" },
  { heading: "Queued", width: "9%", numeric: true },
  { heading: "Done this week", width: "11%", numeric: true },
  { heading: "SOP", width: "12%" },
];

export function EquipmentTable({
  equipment,
  groupBy,
}: {
  equipment: EquipmentListItem[];
  groupBy: EquipmentGroupBy;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {groupEquipment(equipment, groupBy).map((group) => (
        <section
          key={group.name}
          aria-label={group.name}
          className="bg-card min-w-0 overflow-hidden rounded-xl border shadow-xs"
        >
          <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3">
            <h2 className="text-base">{group.name}</h2>
            <span className="text-muted-foreground text-xs">
              {group.items.length}{" "}
              {group.items.length === 1 ? "machine" : "machines"}
            </span>
          </div>
          <div
            role="region"
            aria-label={`${group.name} equipment table`}
            tabIndex={0}
            className="focus-visible:ring-ring/50 overflow-x-auto outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
          >
            <table className="w-full min-w-[960px] table-fixed text-left text-sm">
              <caption className="sr-only">
                {group.name} machines. Done this week counts parts since Monday,
                UTC.
              </caption>
              <colgroup>
                {columns.map((column) => (
                  <col key={column.heading} style={{ width: column.width }} />
                ))}
              </colgroup>
              <thead className="bg-muted text-xs">
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.heading}
                      scope="col"
                      className={
                        column.numeric
                          ? "px-4 py-3 text-right font-semibold"
                          : "px-4 py-3 font-semibold"
                      }
                    >
                      {column.heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.items.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-muted cursor-pointer border-t"
                    onClick={(event) => {
                      if (
                        !(event.target as HTMLElement).closest("a") &&
                        !window.getSelection()?.toString()
                      )
                        window.location.assign(
                          `/equipment/${encodeURIComponent(item.id)}`
                        );
                    }}
                  >
                    <th
                      scope="row"
                      className="px-4 py-3 font-semibold break-words"
                    >
                      <a
                        className="text-[var(--link)] underline-offset-4 hover:underline focus-visible:outline-2"
                        href={`/equipment/${encodeURIComponent(item.id)}`}
                      >
                        {item.name}
                      </a>
                      {item.location && (
                        <div className="text-muted-foreground text-xs font-normal">
                          {item.location}
                        </div>
                      )}
                    </th>
                    <td className="px-4 py-3">
                      <MachineStatusPill status={item.machine_status} />
                    </td>
                    <td className="px-4 py-3 break-words">
                      {item.current_parts?.length ? (
                        item.current_parts.map((part) => part.title).join(", ")
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      )}
                    </td>
                    <td className="brand-figures px-4 py-3 text-right">
                      {item.queue_size}
                    </td>
                    <td className="brand-figures px-4 py-3 text-right">
                      {item.weekly_stats?.done ?? 0}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {item.documentation_url ? (
                        <a
                          className="inline-flex items-center gap-1 font-semibold text-[var(--link)] underline underline-offset-4 focus-visible:outline-2"
                          href={item.documentation_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open SOP
                          <ExternalLink
                            className="size-3.5"
                            aria-hidden="true"
                          />
                        </a>
                      ) : (
                        <a
                          className="text-muted-foreground text-xs underline-offset-4 hover:text-[var(--link)] hover:underline focus-visible:outline-2"
                          href={`/equipment/${encodeURIComponent(item.id)}/edit`}
                          aria-label={`Add SOP link for ${item.name}`}
                        >
                          Add SOP
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
