import { useQuery } from "@tanstack/react-query";
import {
  equipmentQuery,
  kanbanCardsQuery,
  needsMaintenance,
  usersQuery,
  type EquipmentWithProcesses,
  type KanbanCardWithProcesses,
} from "~/lib/api";
import { machineQueue } from "~/lib/machineQueue";
import { machineHref, partHref } from "~/lib/phone";
import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";

const DAY_MS = 24 * 60 * 60 * 1000;
const { backlog, inProgress, review, done } = WORKFLOW_COLUMN_IDS;

/** "40 min", "3 h", "2 d": how long since `since`. */
function elapsed(since: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / (24 * 60))} d`;
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

const sameLocalDay = (a: Date, b: Date) =>
  a.toDateString() === b.toDateString();

/**
 * The shop at a glance for a shop mentor: counts per status, what needs
 * attention, and each machine's status and queue. `date_updated` is when a
 * card entered its current status, so it dates claims, reviews and finishes.
 */
export function ShopPage({ viewerId }: { viewerId: string }) {
  const { data: cards = [] } = useQuery(kanbanCardsQuery());
  const { data: equipment = [] } = useQuery(equipmentQuery());
  const { data: users = [] } = useQuery(usersQuery());
  const now = Date.now();
  const today = new Date(now);

  const inColumn = (id: string) => cards.filter((c) => c.column_id === id);
  const backlogCards = inColumn(backlog);
  const running = inColumn(inProgress);
  const reviewing = inColumn(review);
  const doneToday = inColumn(done).filter((c) =>
    sameLocalDay(new Date(c.date_updated), today)
  );

  const nameOf = (subject: string | null) =>
    subject === viewerId
      ? "You"
      : subject
        ? (users.find((user) => user.onshape_user_id === subject)?.name ??
          subject)
        : "Nobody";

  const machines = [...equipment]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((machine) => ({
      machine,
      queued: machineQueue(machine, cards).length,
      current: running.find((c) => c.machine_id === machine.id),
    }));

  const attention: { text: string; href: string }[] = [
    ...machines
      .filter(
        ({ machine, queued, current }) =>
          !needsMaintenance(machine) && !current && queued > 0
      )
      .map(({ machine, queued }) => ({
        text: `${machine.name} is idle with ${plural(queued, "part", "parts")} waiting`,
        href: machineHref(machine.id),
      })),
    ...reviewing
      .filter((c) => now - Date.parse(c.date_updated) > DAY_MS)
      .map((c) => ({
        text: `${c.title} waiting for review ${elapsed(c.date_updated, now)}`,
        href: partHref(c.id),
      })),
  ];
  const unrouted = backlogCards.filter((c) => !c.machine_id).length;
  if (unrouted > 0)
    attention.push({
      text: `${plural(unrouted, "backlog part has", "backlog parts have")} no machine`,
      href: "/backlog",
    });

  const counts = [
    { label: "Backlog", count: backlogCards.length, href: "/backlog" },
    { label: "In progress", count: running.length },
    { label: "Review", count: reviewing.length },
    { label: "Done today", count: doneToday.length },
  ];

  return (
    <main className="space-y-4">
      <h1 className="text-3xl">Shop</h1>

      <ul aria-label="Counts" className="grid grid-cols-4 gap-2">
        {counts.map(({ label, count, href }) => {
          const body = (
            <>
              <span data-count className="brand-figures text-xl font-bold">
                {count}
              </span>
              <span className="text-muted-foreground text-xs">{label}</span>
            </>
          );
          const tile =
            "bg-card text-foreground flex min-h-11 flex-col rounded-xl border p-2.5 no-underline";
          return (
            <li key={label} className="min-w-0">
              {href ? (
                <a href={href} className={tile}>
                  {body}
                </a>
              ) : (
                <div className={tile}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>

      <section
        aria-labelledby="needs-attention"
        className="bg-muted space-y-1 rounded-lg px-3.5 py-3 shadow-[inset_4px_0_0_var(--color-primary)]"
      >
        <h2 id="needs-attention" className="text-base">
          Needs attention
        </h2>
        {attention.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing right now.</p>
        ) : (
          <ul>
            {attention.map(({ text, href }) => (
              <li key={text}>
                <a href={href} className="flex min-h-11 items-center text-sm">
                  {text}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="machines-heading" className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 id="machines-heading" className="text-base">
            Machines
          </h2>
          <a href="/equipment" className="flex min-h-11 items-center text-sm">
            All equipment
          </a>
        </div>
        <ul
          aria-label="Machines"
          className="bg-card overflow-hidden rounded-xl border"
        >
          {machines.map(({ machine, queued, current }) => (
            <li key={machine.id} className="not-last:border-b">
              <a
                href={machineHref(machine.id)}
                className="text-foreground grid min-h-11 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-3 py-2.5 no-underline"
              >
                <span className="font-semibold break-words">
                  {machine.name}
                </span>
                <span data-queued className="brand-figures font-bold">
                  {queued}
                </span>
                <MachineStatus
                  machine={machine}
                  current={current}
                  owner={current && nameOf(current.assignee)}
                  now={now}
                />
                <span className="text-muted-foreground text-xs">queued</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function MachineStatus({
  machine,
  current,
  owner,
  now,
}: {
  machine: EquipmentWithProcesses;
  current: KanbanCardWithProcesses | undefined;
  owner: string | undefined;
  now: number;
}) {
  if (needsMaintenance(machine))
    return (
      <span data-status className="text-destructive text-xs font-semibold">
        {machine.maintenance_note
          ? `Needs maintenance: ${machine.maintenance_note}`
          : "Needs maintenance"}
      </span>
    );
  return (
    <span data-status className="text-muted-foreground text-xs break-words">
      {current
        ? `${owner} · ${current.title} · ${elapsed(current.date_updated, now)}`
        : "Idle"}
    </span>
  );
}
