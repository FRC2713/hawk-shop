import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  Hammer,
  ListTodo,
  type LucideIcon,
} from "lucide-react";
import {
  equipmentQuery,
  kanbanCardsQuery,
  kanbanColumnsQuery,
  usersQuery,
  type KanbanCardWithProcesses,
} from "~/lib/api";
import { cardMachineName, unlinkedMachineText } from "~/lib/cardMachine";
import { machineQueue } from "~/lib/machineQueue";
import { partHref } from "~/lib/phone";
import {
  isWorkflowColumn,
  WORKFLOW_COLUMN_IDS,
} from "~/server/kanbanApi/columnTypes";
import { elapsed, memberName, needsYouReason } from "~/lib/phoneParts";
import { loadState } from "./LoadState";
import { PartList, PartRow } from "./PartRow";

type Card = KanbanCardWithProcesses;

const WEEK_MS = 7 * 24 * 3_600_000;

const newestFirst = (a: Card, b: Card) =>
  b.date_updated.localeCompare(a.date_updated);

/** Sets the leading number of "6 h" or "2nd" as an aligned figure. */
function figures(text: string): ReactNode {
  const match = /^(\d+)(.*)$/s.exec(text);
  if (!match) return text;
  return (
    <>
      <span className="brand-figures">{match[1]}</span>
      {match[2]}
    </>
  );
}

/**
 * A group heading's count: a quiet figure after the title. The hidden
 * separator keeps the heading's accessible name "Being made · 2".
 */
function Count({ n }: { n: number }) {
  return (
    <>
      <span className="sr-only"> · </span>
      <span className="brand-figures text-muted-foreground text-sm font-normal">
        {n}
      </span>
    </>
  );
}

/** "Sent back from review: ..." with only the prefix in full weight. */
function Reason({ text }: { text: string }) {
  const split = text.indexOf(": ");
  if (split < 0) return <>{text}</>;
  return (
    <>
      <span className="text-foreground font-semibold">
        {text.slice(0, split + 1)}
      </span>
      {text.slice(split + 1)}
    </>
  );
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
 * from review (until someone acts on them again) or released with warnings
 * come first under "Needs you"; the
 * rest group by status. Reads `kanbanCardsQuery`, so live board events
 * refresh it.
 */
export function MyPartsTab({ viewerId }: { viewerId: string }) {
  const cards = useQuery(kanbanCardsQuery());
  const { data: columns = [] } = useQuery(kanbanColumnsQuery());
  const { data: users = [] } = useQuery(usersQuery());
  const { data: equipment = [] } = useQuery(equipmentQuery());

  const pending = loadState([cards], "Loading your parts...");
  if (pending || !cards.data) return <MyPartsShell>{pending}</MyPartsShell>;

  const now = Date.now();
  const mine = cards.data.filter((card) => card.created_by === viewerId);
  if (mine.length === 0)
    return (
      <MyPartsShell>
        <div className="callout callout-teal space-y-0.5">
          <p className="font-semibold">You haven't released any parts yet.</p>
          <p className="text-muted-foreground text-sm">
            Parts appear here when you release them from Onshape.
          </p>
        </div>
      </MyPartsShell>
    );

  const nameOf = (subject: string | null) =>
    memberName(users, subject, viewerId);

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
  const waitingDetail = (card: Card): ReactNode => {
    const machine = equipment.find((item) => item.id === card.machine_id);
    if (machine) {
      const place = machineQueue(machine, cards.data).findIndex(
        (queued) => queued.id === card.id
      );
      return place >= 0 ? (
        <>
          {figures(ordinal(place + 1))} in line · {machine.name}
        </>
      ) : (
        machine.name
      );
    }
    const named = machineOf(card);
    if (named) return named;
    const processes = (card.processes ?? []).map((process) => process.name);
    return processes.length
      ? `Any machine · ${processes.join(" or ")}`
      : "No machine";
  };

  const active = mine.filter(
    (card) => card.column_id !== WORKFLOW_COLUMN_IDS.done
  ).length;
  const doneThisWeek = inColumn(WORKFLOW_COLUMN_IDS.done)
    .filter((card) => now - Date.parse(card.date_updated) <= WEEK_MS)
    .sort(newestFirst);

  return (
    <MyPartsShell
      subtitle={`Released by you · ${active} active${
        needsYou.length === 0 ? " · nothing needs you" : ""
      }`}
    >
      {needsYou.length > 0 && (
        <section aria-labelledby="needs-you" className="space-y-2">
          <h2
            id="needs-you"
            className="section-title text-emphasis flex items-center gap-2"
          >
            <AlertTriangle aria-hidden className="size-4 shrink-0" />
            <span>Needs you</span>
            <Count n={needsYou.length} />
          </h2>
          <ul aria-label="Needs you" className="space-y-2">
            {needsYou.map(({ card, reason }) => (
              <li key={card.id}>
                <a
                  href={partHref(card.id)}
                  className="bg-card text-foreground hover:bg-muted/60 block min-h-11 rounded-lg border px-3.5 py-2.5 no-underline shadow-[inset_4px_0_0_var(--color-primary)] transition-colors"
                >
                  <span className="block font-semibold">{card.title}</span>
                  <span className="text-muted-foreground block text-sm">
                    <Reason text={reason} />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <StatusGroup
        title="Being made"
        icon={Hammer}
        cards={inColumn(WORKFLOW_COLUMN_IDS.inProgress).sort(newestFirst)}
        detail={(card) =>
          [machineOf(card), nameOf(card.assignee)].filter(Boolean).join(" · ")
        }
      />
      <StatusGroup
        title="Waiting"
        icon={Clock}
        cards={inColumn(WORKFLOW_COLUMN_IDS.backlog).sort((a, b) =>
          a.date_created.localeCompare(b.date_created)
        )}
        detail={waitingDetail}
      />
      <StatusGroup
        title="In review"
        icon={Eye}
        cards={inColumn(WORKFLOW_COLUMN_IDS.review).sort(newestFirst)}
        detail={(card) => (
          <>{figures(elapsed(card.date_updated, now))} in review</>
        )}
      />
      {[...new Set(rest.map((card) => card.column_id))]
        .filter((id) => !isWorkflowColumn(id))
        .map((id) => (
          <StatusGroup
            key={id}
            title={columns.find((column) => column.id === id)?.title ?? id}
            icon={ListTodo}
            cards={inColumn(id).sort(newestFirst)}
            detail={(card) => machineOf(card)}
          />
        ))}
      {doneThisWeek.length > 0 && (
        <details className="group space-y-2">
          <summary className="text-foreground -mt-2.5 mb-0 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md">
            <CheckCircle2
              aria-hidden
              className="text-status-active size-4 shrink-0"
            />
            <h2 className="section-title flex items-center gap-2">
              <span>Done this week</span>
              <Count n={doneThisWeek.length} />
            </h2>
            <ChevronRight
              aria-hidden
              className="text-muted-foreground size-4 transition-transform group-open:rotate-90"
            />
          </summary>
          <PartList label="Done this week">
            {doneThisWeek.map((card) => (
              <PartRow
                key={card.id}
                card={card}
                stacked
                detail={
                  <span className="text-sm">
                    {figures(elapsed(card.date_updated, now))} ago
                  </span>
                }
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
  icon: Icon,
  cards,
  detail,
}: {
  title: string;
  icon: LucideIcon;
  cards: Card[];
  detail: (card: Card) => ReactNode;
}) {
  if (cards.length === 0) return null;
  const id = `group-${title.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h2 id={id} className="section-title flex items-center gap-2">
        <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
        <span>{title}</span>
        <Count n={cards.length} />
      </h2>
      <PartList label={title}>
        {cards.map((card) => (
          <PartRow
            key={card.id}
            card={card}
            detail={<span className="text-sm">{detail(card)}</span>}
            stacked
          />
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
    <main className="max-w-3xl space-y-6">
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
