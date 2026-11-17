/**
 * Wording and rules the phone tabs share: who a member is, how long ago,
 * due dates, what a machine is doing, and when a part needs its designer.
 * Client-safe.
 */
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { ApiError } from "~/lib/api/client";
import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";

export type Member = { onshape_user_id: string; name: string | null };

/**
 * A member's name from their Suite subject: "You" for the viewer when
 * `viewerId` is given, "Someone" for a subject not in the user list, null
 * when there is no subject.
 */
export function memberName(
  users: readonly Member[],
  subject: string | null,
  viewerId?: string
): string | null {
  if (!subject) return null;
  if (viewerId && subject === viewerId) return "You";
  return (
    users.find((user) => user.onshape_user_id === subject)?.name ?? "Someone"
  );
}

/** "45 min", "2 h", "3 d": how long since `iso`. */
export function elapsed(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

export { plural } from "~/lib/plural";

/**
 * A due date as a queue row shows it: "due today", the weekday within the
 * next six days, otherwise the date. Past dates are overdue.
 */
export function dueLabel(
  dueDate: string,
  today: Date = new Date()
): { text: string; overdue: boolean } {
  const due = parseISO(dueDate);
  const days = differenceInCalendarDays(due, today);
  if (days < 0)
    return { text: `overdue, due ${format(due, "MMM d")}`, overdue: true };
  if (days === 0) return { text: "due today", overdue: false };
  if (days <= 6) return { text: `due ${format(due, "EEE")}`, overdue: false };
  return { text: `due ${format(due, "MMM d")}`, overdue: false };
}

/** Machines by name, ignoring case, with "Printer 10" after "Printer 2". */
export function byMachineName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

type RunningCard = {
  column_id: string;
  machine_id: string | null;
};

/** The In Progress part on `machine`, if any. */
export function runningOn<C extends RunningCard>(
  machine: { id: string },
  cards: readonly C[]
): C | undefined {
  return cards.find(
    (card) =>
      card.column_id === WORKFLOW_COLUMN_IDS.inProgress &&
      card.machine_id === machine.id
  );
}

/**
 * What a machine is doing, in one line: "Needs maintenance" (with its note),
 * "<who> · <part> · <how long>", or "Idle".
 */
export function machineActivity(
  machine: { status: string | null; maintenance_note?: string | null },
  running:
    | { title: string; assignee: string | null; date_updated: string }
    | undefined,
  users: readonly Member[],
  now: number,
  viewerId?: string
): { text: string; maintenance: boolean } {
  if (machine.status === "maintenance")
    return {
      text: machine.maintenance_note
        ? `Needs maintenance: ${machine.maintenance_note}`
        : "Needs maintenance",
      maintenance: true,
    };
  if (!running) return { text: "Idle", maintenance: false };
  const who = memberName(users, running.assignee, viewerId);
  return {
    text: [who, running.title, elapsed(running.date_updated, now)]
      .filter(Boolean)
      .join(" · "),
    maintenance: false,
  };
}

/** A 409 from the workflow API: someone else got there first. */
export function isConflict(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 409;
}

type DesignerCard = {
  column_id: string;
  date_updated: string;
  release_issues?: { message: string }[] | null;
  review_notes?: { text: string; created_at: string }[];
};

/**
 * Why a part needs its designer, or null when it doesn't. A part sent back
 * from review needs them until someone acts on it again: the send-back note
 * is written with the move, so it is no older than the card's last status
 * change, and any later claim, unclaim or Done makes it older. A release
 * warning needs them until the part is done.
 */
export function needsYouReason(card: DesignerCard): string | null {
  const latest = card.review_notes?.at(-1);
  if (
    latest &&
    card.column_id !== WORKFLOW_COLUMN_IDS.done &&
    card.column_id !== WORKFLOW_COLUMN_IDS.review &&
    latest.created_at >= card.date_updated
  )
    return `Sent back from review: ${latest.text}`;
  const issue = card.release_issues?.[0];
  if (issue && card.column_id !== WORKFLOW_COLUMN_IDS.done)
    return `Release warning: ${issue.message}`;
  return null;
}
