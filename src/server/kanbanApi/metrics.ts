import "virtual:hawk-shop/server-only";

import { asc, eq } from "drizzle-orm";
import { getSessionActor } from "~/lib/sessionActor";
import { db } from "~/server/db/client";
import {
  statusHistory,
  kanbanCardProcesses,
  processes,
} from "~/server/db/schema";
import { getKanbanConfig } from "./config";

export interface MetricsRange {
  start: string;
  end: string;
}

export function parseMetricsRange(
  params: URLSearchParams,
  now = new Date()
): MetricsRange {
  const end = params.get("end") ?? now.toISOString().slice(0, 10);
  const defaultStart = new Date(now);
  defaultStart.setUTCDate(defaultStart.getUTCDate() - 29);
  const start = params.get("start") ?? defaultStart.toISOString().slice(0, 10);
  const validDate = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(start) || !validDate(end) || start > end) {
    throw new Error(
      "Choose valid start and end dates, with the start on or before the end."
    );
  }
  return { start, end };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Aggregates observed history only; see docs/metrics.md for cohort semantics. */
export async function getMetrics(range: MetricsRange) {
  if (!(await getSessionActor())) throw new Error("Suite membership required.");
  const config = await getKanbanConfig();
  const doneId = config.columns.at(-1)?.id;
  const start = Date.parse(`${range.start}T00:00:00.000Z`);
  const until = Date.parse(`${range.end}T00:00:00.000Z`) + 86400000;
  const rows = await db
    .select()
    .from(statusHistory)
    .orderBy(asc(statusHistory.moved_at), asc(statusHistory.id));
  type Row = (typeof rows)[number];
  const previous = new Map<string, Row>();
  const releases = new Map<string, number>();
  const completed = new Set<string>();
  const statuses = new Map<
    string,
    {
      column_id: string;
      status: string;
      durations: number[];
      backward_moves: number;
    }
  >();
  const assignments = await db
    .select({
      card_id: kanbanCardProcesses.card_id,
      process_id: processes.id,
      process: processes.name,
    })
    .from(kanbanCardProcesses)
    .innerJoin(processes, eq(processes.id, kanbanCardProcesses.process_id));
  const processCycles = new Map<
    string | null,
    { process_id: string | null; process: string; durations: number[] }
  >();
  const cycles: number[] = [];
  const weeks = new Map<string, number>();
  for (const row of rows) {
    const time = Date.parse(row.moved_at);
    if (time >= until) break;
    const prior = previous.get(row.card_id);
    if (row.from_column_id === null && !releases.has(row.card_id))
      releases.set(row.card_id, time);
    if (time >= start) {
      const group = (id: string, name: string) => {
        const key = JSON.stringify([id, name]);
        if (!statuses.has(key))
          statuses.set(key, {
            column_id: id,
            status: name,
            durations: [],
            backward_moves: 0,
          });
        return statuses.get(key)!;
      };
      if (prior && prior.to_column_id === row.from_column_id) {
        group(prior.to_column_id, prior.to_status).durations.push(
          time - Date.parse(prior.moved_at)
        );
      }
      if (
        row.from_column_index !== null &&
        row.from_column_index >= 0 &&
        row.to_column_index >= 0 &&
        row.to_column_index < row.from_column_index &&
        row.from_column_id !== null
      ) {
        group(row.from_column_id, row.from_status ?? row.from_column_id)
          .backward_moves++;
      }
    }
    if (row.to_column_id === doneId && !completed.has(row.card_id)) {
      completed.add(row.card_id);
      if (time >= start) {
        const date = new Date(time);
        date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
        const week = date.toISOString().slice(0, 10);
        weeks.set(week, (weeks.get(week) ?? 0) + 1);
        const release = releases.get(row.card_id);
        if (release !== undefined) {
          const duration = time - release;
          cycles.push(duration);
          const current = assignments.filter(
            (assignment) => assignment.card_id === row.card_id
          );
          const groups = current.length
            ? current
            : [{ process_id: null, process: "unknown" }];
          for (const process of groups) {
            if (!processCycles.has(process.process_id))
              processCycles.set(process.process_id, {
                process_id: process.process_id,
                process: process.process,
                durations: [],
              });
            processCycles.get(process.process_id)!.durations.push(duration);
          }
        }
      }
    }
    previous.set(row.card_id, row);
  }
  return {
    range,
    statuses: [...statuses.values()]
      .map(({ durations, ...status }) => {
        durations.sort((a, b) => a - b);
        return {
          ...status,
          samples: durations.length,
          median_ms: median(durations),
          p90_ms: durations.length
            ? durations[Math.ceil(durations.length * 0.9) - 1]
            : null,
          max_ms: durations.at(-1) ?? null,
        };
      })
      .sort(
        (a, b) =>
          a.column_id.localeCompare(b.column_id) ||
          a.status.localeCompare(b.status)
      ),
    cycle: { samples: cycles.length, median_ms: median(cycles) },
    processes: [...processCycles.values()]
      .sort(
        (a, b) =>
          a.process.localeCompare(b.process) ||
          (a.process_id ?? "").localeCompare(b.process_id ?? "")
      )
      .map(({ durations, ...process }) => ({
        ...process,
        samples: durations.length,
        median_ms: median(durations),
      })),
    weeks: [...weeks]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week_start, cards_done]) => ({ week_start, cards_done })),
  };
}
