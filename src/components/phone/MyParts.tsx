import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import {
  equipmentQuery,
  kanbanCardsQuery,
  usersQuery,
  type KanbanCardWithProcesses,
} from "~/lib/api";
import { cardMachineName, unlinkedMachineText } from "~/lib/cardMachine";
import { machineQueue } from "~/lib/machineQueue";
import { partHref } from "~/lib/phone";
import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";
import { ErrorMessage } from "~/components/mfg/ErrorDisplay";
import { Button } from "~/components/ui/button";
import { PartList, PartRow } from "./PartRow";

type Card = KanbanCardWithProcesses;

const WEEK_MS = 7 * 24 * 3_600_000;

/** Why a part needs its submitter, or null when it doesn't. */
function needsYouReason(card: Card): string | null {
  const notes = card.review_notes ?? [];
  const sentBack =
    notes.length > 0 &&
    (card.column_id === WORKFLOW_COLUMN_IDS.backlog ||
      card.column_id === WORKFLOW_COLUMN_IDS.inProgress);
  if (sentBack) return `Sent back from review: ${notes[notes.length - 1].text}`;
  const issue = card.release_issues?.[0];
  if (issue && card.column_id !== WORKFLOW_COLUMN_IDS.done)
    return `Release warning: ${issue.message}`;
  return null;
}

const newestFirst = (a: Card, b: Card) =>
  b.date_updated.localeCompare(a.date_updated);

/** "45 min", "2 h", "3 d": how long ago `iso` was. */
function elapsed(iso: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

function ordinal(n: number) {
  const tens = n % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? "th"
      : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ??
        "th");
  return `${n}${suffix}`;
}

/**
 * The My parts tab: the signed-in member's released parts. Parts sent back
 * from review or released with warnings come first under "Needs you"; the
 * rest group by status. Reads `kanbanCardsQuery`, so live board events
 * refresh it.
 */
export function MyParts({ viewerId }: { viewerId: string }) {
  const cards = useQuery(kanbanCardsQuery());
  const { data: users = [] } = useQuery(usersQuery());
  const { data: equipment = [] } = useQuery(equipmentQuery());

  if (cards.isPending)
    return (
      <MyPartsShell>
        <p role="status" className="text-muted-foreground">
          Loading your parts...
        </p>
      </MyPartsShell>
    );
  if (cards.isError)
    return (
      <MyPartsShell>
        <section role="alert" className="space-y-2">
          <ErrorMessage error={cards.error} />
          <Button variant="outline" onClick={() => cards.refetch()}>
            Try again
          </Button>
        </section>
      </MyPartsShell>
    );

  const now = Date.now();
  const mine = cards.data.filter((card) => card.created_by === viewerId);
  if (mine.length === 0)
    return (
      <MyPartsShell>
        <p className="text-muted-foreground">
          You haven't released any parts yet.
        </p>
      </MyPartsShell>
    );

  const nameOf = (subject: string | null) =>
    subject
      ? (users.find((user) => user.onshape_user_id === subject)?.name ??
        subject)
      : null;

  const needsYou = mine
    .map((card) => ({ card, reason: needsYouReason(card) }))
    .filter((item): item is { card: Card; reason: string } => !!item.reason)
    .sort(
      (a, b) =>
        Number(b.reason.startsWith("Sent back")) -
          Number(a.reason.startsWith("Sent back")) ||
        newestFirst(a.card, b.card)
    );
  const rest = mine.filter((card) => !needsYouReason(card));
  const inColumn = (columnId: string) =>
    rest.filter((card) => card.column_id === columnId);

  const machineOf = (card: Card) =>
    cardMachineName(card) ?? unlinkedMachineText(card);
  const waitingDetail = (card: Card) => {
    const machine = equipment.find((item) => item.id === card.machine_id);
    if (machine) {
      const place = machineQueue(machine, cards.data).findIndex(
        (queued) => queued.id === card.id
      );
      return place >= 0
        ? `${ordinal(place + 1)} for ${machine.name}`
        : machine.name;
    }
    const named = machineOf(card);
    if (named) return named;
    const processes = (card.processes ?? []).map((process) => process.name);
    return processes.length ? `Any ${processes.join(" or ")}` : "No machine";
  };

  const active = mine.filter(
    (card) => card.column_id !== WORKFLOW_COLUMN_IDS.done
  ).length;
  const doneThisWeek = inColumn(WORKFLOW_COLUMN_IDS.done)
    .filter((card) => now - Date.parse(card.date_updated) <= WEEK_MS)
    .sort(newestFirst);

  return (
    <MyPartsShell subtitle={`Released by you · ${active} active`}>
      {needsYou.length > 0 && (
        <section aria-labelledby="needs-you" className="space-y-2">
          <h2 id="needs-you" className="text-base">
            Needs you · {needsYou.length}
          </h2>
          <ul aria-label="Needs you" className="space-y-2">
            {needsYou.map(({ card, reason }) => (
              <li key={card.id}>
                <a
                  href={partHref(card.id)}
                  className="bg-card text-foreground block min-h-11 rounded-lg border px-3.5 py-2.5 no-underline shadow-[inset_4px_0_0_var(--color-primary)]"
                >
                  <span className="block font-semibold">{card.title}</span>
                  <span className="block text-sm">{reason}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <StatusGroup
        title="Being made"
        cards={inColumn(WORKFLOW_COLUMN_IDS.inProgress).sort(newestFirst)}
        detail={(card) =>
          [machineOf(card), nameOf(card.assignee)].filter(Boolean).join(" · ")
        }
      />
      <StatusGroup
        title="Waiting"
        cards={inColumn(WORKFLOW_COLUMN_IDS.backlog).sort((a, b) =>
          a.date_created.localeCompare(b.date_created)
        )}
        detail={waitingDetail}
      />
      <StatusGroup
        title="In review"
        cards={inColumn(WORKFLOW_COLUMN_IDS.review).sort(newestFirst)}
        detail={(card) => `since ${elapsed(card.date_updated, now)}`}
      />
      {doneThisWeek.length > 0 && (
        <details className="group space-y-2">
          <summary className="text-status-active flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm">
            <h2 className="text-status-active text-sm">
              Done this week · {doneThisWeek.length}
            </h2>
            <ChevronRight
              aria-hidden
              className="size-4 transition-transform group-open:rotate-90"
            />
          </summary>
          <PartList label="Done this week">
            {doneThisWeek.map((card) => (
              <PartRow
                key={card.id}
                card={card}
                detail={`${elapsed(card.date_updated, now)} ago`}
              />
            ))}
          </PartList>
        </details>
      )}
    </MyPartsShell>
  );
}

function StatusGroup({
  title,
  cards,
  detail,
}: {
  title: string;
  cards: Card[];
  detail: (card: Card) => ReactNode;
}) {
  if (cards.length === 0) return null;
  const id = `group-${title.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h2 id={id} className="text-base">
        {title} · {cards.length}
      </h2>
      <PartList label={title}>
        {cards.map((card) => (
          <PartRow key={card.id} card={card} detail={detail(card)} />
        ))}
      </PartList>
    </section>
  );
}

function MyPartsShell({
  subtitle,
  children,
}: {
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-3xl">My parts</h1>
        {subtitle && (
          <p className="text-muted-foreground text-sm">{subtitle}</p>
        )}
      </header>
      {children}
    </main>
  );
}
