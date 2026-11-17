import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Workflow } from "./Workflow";
import { Button } from "~/components/ui/button";
import { ErrorDisplay } from "~/components/mfg/ErrorDisplay";
import {
  equipmentQuery,
  flagEquipmentMaintenance,
  machineQueueQuery,
  reorderMachineQueue,
} from "~/lib/api/equipment";
import { kanbanCardDetailsQuery } from "~/lib/api/kanban";
import { userQuery } from "~/lib/api/users";
import { queryKeys } from "~/lib/api/keys";
import { machineStatusLabels } from "~/lib/equipment";

function CurrentPart({ id, title }: { id: string; title: string }) {
  const details = useQuery(kanbanCardDetailsQuery(id));
  const user = useQuery(userQuery(details.data?.assignee));
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  const entered = details.data?.status_history
    .filter((entry) => entry.to_column_id === "in-progress")
    .sort((a, b) => b.moved_at.localeCompare(a.moved_at))[0]?.moved_at;
  return (
    <li className="space-y-1 rounded-md border p-4 break-words">
      <h3 className="font-semibold">{title}</h3>
      <p>
        {details.data?.assignee
          ? user.data?.name || "Assigned member"
          : "Unassigned"}
      </p>
      <p className="text-muted-foreground text-sm">
        In Progress ·{" "}
        {entered ? (
          <time dateTime={entered}>
            {formatDistanceToNow(new Date(entered))} in status
          </time>
        ) : (
          "Time in status unknown"
        )}
      </p>
      {details.error && <ErrorDisplay error={details.error} />}
      {user.error && <ErrorDisplay error={user.error} />}
    </li>
  );
}

export function MachinePageContent({ id }: { id: string }) {
  const client = useQueryClient();
  const equipment = useQuery(equipmentQuery());
  const queue = useQuery(machineQueueQuery(id));
  const machine = equipment.data?.find((item) => item.id === id);
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState("");
  const report = useMutation({
    mutationFn: () => flagEquipmentMaintenance(id, note),
    onSuccess: async () => {
      setReporting(false);
      setNote("");
      await client.invalidateQueries({ queryKey: queryKeys.equipment.all() });
    },
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => reorderMachineQueue(id, ids),
    onSuccess: async (cards) => {
      client.setQueryData(queryKeys.kanban.machineQueue(id), cards);
      await client.invalidateQueries({ queryKey: queryKeys.kanban.cards() });
      await client.invalidateQueries({ queryKey: queryKeys.equipment.all() });
    },
  });
  const move = (index: number, delta: number) => {
    const ids = queue.data!.map((card) => card.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    reorder.mutate(ids);
  };
  const edit = `/equipment/${encodeURIComponent(id)}/edit`;
  return (
    <main className="h-full overflow-y-auto px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <a href="/equipment" className="text-link underline">
          Back to equipment
        </a>
        {equipment.error ? (
          <ErrorDisplay error={equipment.error} />
        ) : equipment.isPending ? (
          <p role="status">Loading machine…</p>
        ) : !machine ? (
          <h1>Equipment not found</h1>
        ) : (
          <>
            <header className="space-y-2">
              <h1 className="text-3xl font-bold break-words uppercase italic">
                {machine.name}
              </h1>
              <p>{machine.location || "No location set"}</p>
              <p>
                {machine.processes.map((process) => process.name).join(", ") ||
                  "No process"}
              </p>
              <p className="font-semibold">
                {machineStatusLabels[machine.machine_status]}
              </p>
              {machine.description && (
                <p className="break-words">{machine.description}</p>
              )}
            </header>
            {!!machine.image_urls?.length && (
              <div
                className="flex gap-3 overflow-x-auto"
                aria-label="Machine photos"
              >
                {machine.image_urls.map((url, index) => (
                  <img
                    key={url}
                    src={url}
                    alt={`${machine.name} photo ${index + 1}`}
                    className="h-48 w-64 shrink-0 rounded-md border object-contain"
                  />
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <a
                  href={machine.documentation_url || edit}
                  {...(machine.documentation_url
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                >
                  {machine.documentation_url ? "Open SOP" : "Add SOP link"}
                </a>
              </Button>
              <Button variant="outline" onClick={() => setReporting(true)}>
                Report a problem
              </Button>
              <Button asChild variant="outline">
                <a href={edit}>Edit equipment</a>
              </Button>
            </div>
            {reporting && (
              <form
                className="space-y-3 rounded-md border p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  report.mutate();
                }}
              >
                <label htmlFor="problem-note" className="block font-semibold">
                  Problem note
                </label>
                <textarea
                  id="problem-note"
                  required
                  maxLength={1000}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  className="bg-background min-h-28 w-full rounded-md border p-3"
                />
                <p className="text-muted-foreground text-sm">
                  Your signed-in name is recorded with this report.
                </p>
                {report.error && <ErrorDisplay error={report.error} />}
                <div className="flex gap-3">
                  <Button
                    disabled={report.isPending || !note.trim()}
                    type="submit"
                  >
                    Submit report
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setReporting(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
            {machine.maintenance_note && (
              <aside className="border-destructive bg-muted space-y-2 rounded-md border-l-4 p-4 break-words">
                <h2 className="font-semibold">Needs maintenance</h2>
                <p>{machine.maintenance_note}</p>
                <p>
                  Reported by {machine.maintenance_reported_by || "Unknown"}
                </p>
              </aside>
            )}
            <section aria-label="Now" className="space-y-3">
              <h2 className="text-xl font-semibold">Now</h2>
              {machine.current_parts.length ? (
                <ul className="space-y-3">
                  {machine.current_parts.map((part) => (
                    <CurrentPart key={part.id} {...part} />
                  ))}
                </ul>
              ) : (
                <p>No part in progress.</p>
              )}
            </section>
            <section aria-label="Queue" className="space-y-3">
              <h2 className="text-xl font-semibold">Queue</h2>
              <p className="text-muted-foreground text-sm">
                Backlog parts on this machine, plus compatible parts waiting for
                a machine. Use the arrows to change their order.
              </p>
              {queue.error ? (
                <ErrorDisplay error={queue.error} />
              ) : queue.isPending ? (
                <p role="status">Loading queue…</p>
              ) : !queue.data.length ? (
                <p>No parts queued.</p>
              ) : (
                <ol
                  aria-label="Machine queue"
                  className="list-inside list-decimal space-y-3"
                >
                  {queue.data.map((card, index) => (
                    <li
                      key={card.id}
                      className="rounded-md border p-3 break-words"
                    >
                      <span className="font-semibold">{card.title}</span>
                      <div className="mt-2 flex gap-2">
                        <Button
                          variant="outline"
                          aria-label={`Move ${card.title} up`}
                          disabled={!index || reorder.isPending}
                          onClick={() => move(index, -1)}
                        >
                          ↑ Up
                        </Button>
                        <Button
                          variant="outline"
                          aria-label={`Move ${card.title} down`}
                          disabled={
                            index === queue.data.length - 1 || reorder.isPending
                          }
                          onClick={() => move(index, 1)}
                        >
                          ↓ Down
                        </Button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {reorder.error && <ErrorDisplay error={reorder.error} />}
              <p role="status" className="sr-only">
                {reorder.isPending
                  ? "Saving queue order"
                  : reorder.isSuccess
                    ? "Queue order saved"
                    : ""}
              </p>
            </section>
            <section
              aria-label="This week"
              className="space-y-2 rounded-md border p-4"
            >
              <h2 className="text-xl font-semibold">This week</h2>
              <p className="brand-figures">
                {machine.weekly_stats.done} parts done
              </p>
              <p className="brand-figures">
                {machine.weekly_stats.sent_back} sent back
              </p>
              <p className="text-muted-foreground text-sm">
                Since Monday, UTC. Counts distinct parts, not quantities.
              </p>
            </section>
            <section className="space-y-2">
              <h2 className="text-xl font-semibold">Last maintenance</h2>
              <p>
                {machine.maintenance_reported_at ? (
                  <>
                    Problem reported{" "}
                    <time dateTime={machine.maintenance_reported_at}>
                      {new Date(
                        machine.maintenance_reported_at
                      ).toLocaleString()}
                    </time>
                  </>
                ) : (
                  "No maintenance date recorded."
                )}
              </p>
              <p className="text-muted-foreground text-sm">
                The recorded date is the active problem report. Marking fixed
                clears it; past repairs are not recorded.
              </p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

export default function MachinePage({ id }: { id: string }) {
  return (
    <Workflow>
      <MachinePageContent id={id} />
    </Workflow>
  );
}
