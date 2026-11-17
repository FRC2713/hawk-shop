import { machineStatusLabels, type EquipmentListItem } from "~/lib/equipment";
import { groupEquipment, type EquipmentGroupBy } from "./EquipmentList";

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
            <table className="w-full min-w-[960px] text-left text-sm">
              <caption className="sr-only">
                {group.name} machines. Done this week counts parts since Monday,
                UTC.
              </caption>
              <thead className="bg-muted text-xs">
                <tr>
                  {[
                    "Machine",
                    "Status",
                    "Current part",
                    "Queued",
                    "Done this week",
                    "SOP",
                  ].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="px-4 py-3 font-semibold"
                    >
                      {heading}
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
                    <th scope="row" className="px-4 py-3 font-semibold">
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
                    <td className="px-4 py-3 whitespace-nowrap">
                      {machineStatusLabels[item.machine_status]}
                    </td>
                    <td className="px-4 py-3">
                      {item.current_parts?.length
                        ? item.current_parts
                            .map((part) => part.title)
                            .join(", ")
                        : "None"}
                    </td>
                    <td className="brand-figures px-4 py-3">
                      {item.queue_size}
                    </td>
                    <td className="brand-figures px-4 py-3">
                      {item.weekly_stats?.done ?? 0}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <a
                        className="text-[var(--link)] underline underline-offset-4 focus-visible:outline-2"
                        href={
                          item.documentation_url ||
                          `/equipment/${encodeURIComponent(item.id)}/edit`
                        }
                        target={item.documentation_url ? "_blank" : undefined}
                        rel={item.documentation_url ? "noreferrer" : undefined}
                      >
                        {item.documentation_url ? "Open SOP" : "Add SOP link"}
                      </a>
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
