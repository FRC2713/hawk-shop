/**
 * Board rows: each status column split into one row per process or per
 * project. Client-safe and pure, so the grouping rules are testable apart
 * from the board.
 */

export type BoardRowsBy = "none" | "process" | "project";

export const BOARD_ROWS_LABELS: Record<BoardRowsBy, string> = {
  none: "None",
  process: "Process",
  project: "Project",
};

/** One row of the board; `meta` is the process row's machine summary. */
export type BoardRow = {
  id: string;
  name: string;
  meta?: string;
  archived?: boolean;
};

/** The row id for cards with no process. */
export const NO_PROCESS_ROW = "none";

type RowCard = {
  project_id: string;
  machine_id: string | null;
  processes?: { id: string }[];
};

type RowMachine = {
  id: string;
  name: string;
  status: string | null;
  machine_status?: string;
  processes: { id: string }[];
};

/**
 * The process row a card sits in: its assigned machine's process (the first
 * one the card also needs, else the machine's first), else the card's first
 * process, else "No process". Each card is in exactly one row.
 */
export function cardProcessRowId(
  card: RowCard,
  machinesById: Map<string, RowMachine>
): string {
  const machine = card.machine_id
    ? machinesById.get(card.machine_id)
    : undefined;
  if (machine?.processes.length) {
    const needed = new Set(card.processes?.map((process) => process.id));
    return (
      machine.processes.find((process) => needed.has(process.id)) ??
      machine.processes[0]
    ).id;
  }
  return card.processes?.[0]?.id ?? NO_PROCESS_ROW;
}

/** The row id `card` belongs to under `rowsBy`. */
export function cardRowId(
  card: RowCard,
  rowsBy: BoardRowsBy,
  machinesById: Map<string, RowMachine>
): string {
  return rowsBy === "project"
    ? card.project_id
    : cardProcessRowId(card, machinesById);
}

const isDown = (machine: RowMachine) =>
  machine.status === "maintenance" ||
  machine.machine_status === "needs-maintenance";

/**
 * A process's machines in a few words: their names when one or two
 * ("Chop saw · Band saw"), else a count ("3 machines · 1 down").
 */
export function machineSummary(machines: RowMachine[]): string {
  if (machines.length === 0) return "No machines";
  const down = machines.filter(isDown).length;
  if (machines.length <= 2)
    return machines
      .map((machine) =>
        isDown(machine) ? `${machine.name} (down)` : machine.name
      )
      .join(" · ");
  const count = `${machines.length} machines`;
  return down ? `${count} · ${down} down` : count;
}

/**
 * One row per process in the order given, each with its machine summary,
 * plus "No process" when a shown card has none. Empty processes keep their
 * row so a mentor sees idle parts of the shop and can drop into them.
 */
export function processRows(
  processes: { id: string; name: string }[],
  machines: RowMachine[],
  rowIdsInUse: Set<string>
): BoardRow[] {
  const rows: BoardRow[] = processes.map((process) => ({
    id: process.id,
    name: process.name,
    meta: machineSummary(
      machines.filter((machine) =>
        machine.processes.some((candidate) => candidate.id === process.id)
      )
    ),
  }));
  if (rowIdsInUse.has(NO_PROCESS_ROW))
    rows.push({ id: NO_PROCESS_ROW, name: "No process" });
  return rows;
}

/** One row per project with shown cards, in the order given. */
export function projectRows(
  projects: { id: string; name: string; archived_at: string | null }[],
  rowIdsInUse: Set<string>
): BoardRow[] {
  return projects
    .filter((project) => rowIdsInUse.has(project.id))
    .map((project) => ({
      id: project.id,
      name: project.name,
      archived: !!project.archived_at,
    }));
}
