import { useMinuteClock } from "~/hooks/useMinuteClock";
import { isDoneToday } from "~/lib/doneToday";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Wrench } from "lucide-react";
import {
  equipmentQuery,
  kanbanCardsQuery,
  needsMaintenance,
  usersQuery,
} from "~/lib/api";
import { machineQueue } from "~/lib/machineQueue";
import { machineHref, partHref } from "~/lib/phone";
import {
  byMachineName,
  elapsed,
  machineActivity,
  plural,
  runningOn,
} from "~/lib/phoneParts";
import { loadState } from "./LoadState";
import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";

const DAY_MS = 24 * 60 * 60 * 1000;
const { backlog, inProgress, review, done } = WORKFLOW_COLUMN_IDS;

/**
 * The shop at a glance for a shop mentor: counts per status, what needs
 * attention, and each machine's status and queue. `date_updated` is when a
 * card entered its current status, so it dates claims, reviews and finishes.
 */
export function ShopTab({ viewerId }: { viewerId: string }) {
  const now = useMinuteClock();
  const cardsQuery = useQuery(kanbanCardsQuery());
  const equipmentResult = useQuery(equipmentQuery());
  const { data: users = [] } = useQuery(usersQuery());
  const pending = loadState([cardsQuery, equipmentResult], "Loading shop...");
  if (pending)
    return (
      <main className="space-y-4">
        <h1 className="text-3xl">Shop</h1>
        {pending}
      </main>
    );
  const cards = cardsQuery.data ?? [];
  const equipment = equipmentResult.data ?? [];
  const today = new Date(now);

  const inColumn = (id: string) => cards.filter((c) => c.column_id === id);
  const backlogCards = inColumn(backlog);
  const running = inColumn(inProgress);
  const reviewing = inColumn(review);
  const doneToday = inColumn(done).filter((c) => isDoneToday(c, today));

  const machines = [...equipment].sort(byMachineName).map((machine) => ({
    machine,
    queued: machineQueue(machine, cards).length,
    current: runningOn(machine, cards),
  }));

  // Each item is its subject, why it needs attention and, for waits, how
  // long. Read together they make one sentence.
  const attention: {
    subject: string;
    reason: string;
    time?: string;
    href: string;
  }[] = [
    ...machines
      .filter(
        ({ machine, queued, current }) =>
          !needsMaintenance(machine) && !current && queued > 0
      )
      .map(({ machine, queued }) => ({
        subject: machine.name,
        reason: `is idle with ${plural(queued, "part", "parts")} waiting`,
        href: machineHref(machine.id),
      })),
    ...reviewing
      .filter((c) => now - Date.parse(c.date_updated) > DAY_MS)
      .map((c) => ({
        subject: c.title,
        reason: "waiting for review",
        time: elapsed(c.date_updated, now),
        href: partHref(c.id),
      })),
  ];
  const unrouted = backlogCards.filter((c) => !c.machine_id).length;
  if (unrouted > 0)
    attention.push({
      subject: plural(unrouted, "backlog part", "backlog parts"),
      reason: unrouted === 1 ? "has no machine" : "have no machine",
      href: "/backlog",
    });

  const counts = [
    { label: "Backlog", count: backlogCards.length, href: "/backlog" },
    { label: "In progress", count: running.length },
    { label: "Review", count: reviewing.length },
    { label: "Done today", count: doneToday.length },
  ];

  return (
    <main className="space-y-5">
      <h1 className="text-3xl">Shop</h1>

      <ul
        aria-label="Counts"
        className="grid grid-cols-4 gap-2 lg:flex lg:flex-wrap lg:gap-4"
      >
        {counts.map(({ label, count, href }) => {
          // Only Backlog is a link, so only it has a border and a chevron;
          // the other counts are plain figures. Every tile keeps the same
          // padding, so on desktop the figures fall at an even rhythm.
          const body = (
            <>
              <span
                data-count
                className="brand-figures text-2xl leading-none font-bold lg:text-3xl"
              >
                {count}
              </span>
              <span className="text-muted-foreground text-[11px] leading-tight whitespace-nowrap lg:text-sm">
                {label}
                {href && (
                  <ChevronRight
                    aria-hidden
                    className="ml-0.5 inline-block size-3.5 align-[-2px]"
                  />
                )}
              </span>
            </>
          );
          const tile =
            "text-foreground flex min-h-11 flex-col gap-1.5 rounded-xl border p-2.5 no-underline lg:flex-row lg:items-baseline lg:gap-2.5 lg:px-4 lg:py-3";
          return (
            <li key={label} className="min-w-0">
              {href ? (
                <a
                  href={href}
                  className={`${tile} bg-card hover:border-primary transition-colors`}
                >
                  {body}
                </a>
              ) : (
                <div className={`${tile} border-transparent bg-transparent`}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="space-y-5 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start lg:gap-6 lg:space-y-0">
        <section
          aria-labelledby="needs-attention"
          className="callout callout-red space-y-1 lg:sticky lg:top-6"
        >
          <h2 id="needs-attention" className="section-title">
            Needs attention
            {attention.length > 0 && (
              <span className="text-muted-foreground">
                {" · "}
                <span className="brand-figures">{attention.length}</span>
              </span>
            )}
          </h2>
          {attention.length === 0 ? (
            <p className="text-muted-foreground flex min-h-11 items-center text-sm">
              Nothing right now.
            </p>
          ) : (
            <ul>
              {attention.map(({ subject, reason, time, href }) => (
                <li
                  key={`${href} ${subject}`}
                  className="border-border/60 border-b last:border-0"
                >
                  <a
                    href={href}
                    className="text-foreground hover:bg-background/60 -mx-2 flex min-h-11 items-center justify-between gap-3 rounded-md px-2 py-2 text-sm no-underline transition-colors"
                  >
                    <span className="min-w-0">
                      <span className="font-semibold">{subject}</span>{" "}
                      <span className="text-muted-foreground">
                        <Reason reason={reason} time={time} />
                      </span>
                    </span>
                    <ChevronRight
                      aria-hidden
                      className="text-muted-foreground size-4 shrink-0"
                    />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="machines-heading" className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <h2 id="machines-heading" className="section-title">
              Machines
            </h2>
            <a href="/equipment" className="section-link">
              All equipment
              <ChevronRight aria-hidden className="size-4" />
            </a>
          </div>
          <ul
            aria-label="Machines"
            className="bg-card overflow-hidden rounded-xl border"
          >
            {machines.map(({ machine, queued, current }) => {
              const { text, maintenance } = machineActivity(
                machine,
                current,
                users,
                now,
                viewerId
              );
              const state: MachineState = maintenance
                ? "maintenance"
                : current
                  ? "running"
                  : "idle";
              // Maintenance shows the note's first sentence; the machine page has
              // the full text.
              const detail =
                state === "running"
                  ? text
                  : state === "maintenance"
                    ? firstSentence(machine.maintenance_note)
                    : queued > 0
                      ? `${plural(queued, "part", "parts")} waiting`
                      : "Nothing queued";
              return (
                <li key={machine.id} className="not-last:border-b">
                  <a
                    href={machineHref(machine.id)}
                    className="text-foreground hover:bg-muted grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-3.5 py-3 no-underline transition-colors"
                  >
                    <span className="min-w-0 space-y-0.5">
                      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                        <span className="font-semibold break-words">
                          {machine.name}
                        </span>
                        <MachineStatus state={state} waiting={queued > 0} />
                      </span>
                      {detail && (
                        <span
                          data-detail
                          className="text-muted-foreground line-clamp-1 text-xs break-words"
                        >
                          {detail}
                        </span>
                      )}
                    </span>
                    <span className="flex flex-col items-end">
                      <span
                        data-queued
                        className="brand-figures text-lg leading-none font-bold"
                      >
                        {queued}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        queued
                      </span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </main>
  );
}

/** A reason, ending in its elapsed time when it has one. The last word and
 * the time don't break apart, so "2 d" never wraps onto a line alone. */
function Reason({ reason, time }: { reason: string; time?: string }) {
  if (!time) return reason;
  const cut = reason.lastIndexOf(" ");
  return (
    <>
      {reason.slice(0, cut + 1)}
      <span className="whitespace-nowrap">
        {reason.slice(cut + 1)} {time}
      </span>
    </>
  );
}

/** A note's first sentence, so a clamped line never ends in ".…". */
function firstSentence(note: string | null | undefined) {
  if (!note) return null;
  return note.trim().split(/(?<=[.!?])\s/)[0];
}

type MachineState = "running" | "idle" | "maintenance";

/** The machine's state as a word with an icon, so it never rests on color. */
function MachineStatus({
  state,
  waiting,
}: {
  state: MachineState;
  waiting: boolean;
}) {
  if (state === "maintenance")
    return (
      <span
        data-status
        className="text-emphasis inline-flex items-center gap-1 text-xs font-semibold"
      >
        <Wrench aria-hidden className="text-destructive size-3.5" />
        Maintenance
      </span>
    );
  if (state === "running")
    return (
      <span
        data-status
        className="text-foreground inline-flex items-center gap-1.5 text-xs font-semibold"
      >
        <span
          aria-hidden
          className="size-2 rounded-full bg-[var(--hawk-teal)]"
        />
        Running
      </span>
    );
  return (
    <span
      data-status
      className={`${waiting ? "text-foreground" : "text-muted-foreground"} inline-flex items-center gap-1.5 text-xs font-semibold`}
    >
      <span
        aria-hidden
        className={`size-2 rounded-full border-[1.5px] ${waiting ? "border-destructive" : "border-current"}`}
      />
      Idle
    </span>
  );
}
