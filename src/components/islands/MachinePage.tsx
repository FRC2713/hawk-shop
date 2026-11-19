import { latestStatusEntry } from "~/lib/statusHistory";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ExternalLink,
  Link2,
  MapPin,
  Pencil,
  Trash2,
  TriangleAlert,
  User,
} from "lucide-react";
import { Workflow } from "./Workflow";
import { Button } from "~/components/ui/button";
import { ErrorDisplay } from "~/components/mfg/ErrorDisplay";
import {
  equipmentQuery,
  flagEquipmentMaintenance,
  clearEquipmentMaintenance,
  machineQueueQuery,
  reorderMachineQueue,
} from "~/lib/api/equipment";
import { DeleteEquipmentDialog } from "~/components/mfg/equipment/DeleteEquipmentDialog";
import { kanbanCardsQuery, kanbanCardDetailsQuery } from "~/lib/api/kanban";
import { userQuery } from "~/lib/api/users";
import { queryKeys } from "~/lib/api/keys";
import { MachineStatusPill } from "~/components/mfg/equipment/MachineStatusPill";

function CurrentPart({ id, title }: { id: string; title: string }) {
  const details = useQuery(kanbanCardDetailsQuery(id));
  const user = useQuery(userQuery(details.data?.assignee));
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  const entered = latestStatusEntry(
    details.data?.status_history,
    "in-progress"
  );
  return (
    <li className="bg-card space-y-1 rounded-lg border p-4 break-words shadow-xs">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1">
          <User className="size-3.5" aria-hidden="true" />
          {details.data?.assignee
            ? user.data?.name || "Assigned member"
            : "Unassigned"}
        </span>
        <span>
          In Progress ·{" "}
          {entered ? (
            <time dateTime={entered}>
              {formatDistanceToNow(new Date(entered))} in status
            </time>
          ) : (
            "Time in status unknown"
          )}
        </span>
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
  const [deleting, setDeleting] = useState(false);
  const cards = useQuery({ ...kanbanCardsQuery(), enabled: deleting });
  const fix = useMutation({
    mutationFn: () => clearEquipmentMaintenance(id),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: queryKeys.equipment.all() }),
  });
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
    <main className="h-full overflow-y-auto pt-4 pb-10">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-5">
        <a
          href="/equipment"
          className="text-muted-foreground focus-visible:ring-ring/50 -ml-1 inline-flex min-h-11 items-center gap-1 rounded-md pr-2 text-sm font-semibold outline-none hover:text-[var(--link)] focus-visible:ring-[3px]"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Back to equipment
        </a>
        {equipment.error ? (
          <ErrorDisplay error={equipment.error} />
        ) : equipment.isPending ? (
          <p role="status">Loading machine…</p>
        ) : !machine ? (
          <h1 className="text-3xl">Equipment not found</h1>
        ) : (
          <>
            <header className="-mt-2 space-y-3">
              <h1 className="text-3xl break-words">{machine.name}</h1>
              <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-4" aria-hidden="true" />
                  {machine.location || "No location set"}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {machine.processes
                    .map((process) => process.name)
                    .join(", ") || "No process"}
                </span>
                <MachineStatusPill status={machine.machine_status} />
              </p>
              {machine.description && (
                <p className="max-w-prose break-words">{machine.description}</p>
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
                    className="bg-card h-48 w-64 shrink-0 rounded-lg border object-contain"
                  />
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {machine.documentation_url ? (
                <Button asChild className="col-span-2 min-h-11 sm:min-h-9">
                  <a
                    href={machine.documentation_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink aria-hidden="true" />
                    Open SOP
                  </a>
                </Button>
              ) : (
                <Button
                  asChild
                  variant="outline"
                  className="col-span-2 min-h-11 sm:min-h-9"
                >
                  <a href={edit}>
                    <Link2 aria-hidden="true" />
                    Add SOP link
                  </a>
                </Button>
              )}
              <Button
                variant="outline"
                className="min-h-11 sm:min-h-9"
                onClick={() => setReporting(true)}
              >
                <TriangleAlert aria-hidden="true" />
                Report a problem
              </Button>
              <Button asChild variant="outline" className="min-h-11 sm:min-h-9">
                <a href={edit}>
                  <Pencil aria-hidden="true" />
                  Edit equipment
                </a>
              </Button>
            </div>
            {reporting && (
              <form
                className="bg-card space-y-3 rounded-lg border p-4"
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
              <aside className="callout callout-red space-y-2 pl-5 break-words">
                <h2 className="section-title">Needs maintenance</h2>
                <p>{machine.maintenance_note}</p>
                <p className="text-muted-foreground text-sm">
                  Reported by {machine.maintenance_reported_by || "Unknown"}
                </p>
                <Button
                  variant="outline"
                  className="min-h-11 sm:min-h-9"
                  disabled={fix.isPending}
                  onClick={() => fix.mutate()}
                >
                  Mark fixed
                </Button>
                {fix.error && <ErrorDisplay error={fix.error} />}
              </aside>
            )}
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:gap-8">
              <div className="min-w-0 space-y-6">
                <section aria-label="Now" className="space-y-3">
                  <h2 className="section-title">Now</h2>
                  {machine.current_parts.length ? (
                    <ul className="space-y-3">
                      {machine.current_parts.map((part) => (
                        <CurrentPart key={part.id} {...part} />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
                      No part in progress.
                    </p>
                  )}
                </section>
                <section aria-label="Queue" className="space-y-3">
                  <div>
                    <h2 className="section-title flex items-baseline gap-2">
                      Queue
                      {!!queue.data?.length && (
                        <span className="brand-figures text-muted-foreground text-sm font-normal">
                          {queue.data.length}
                        </span>
                      )}
                    </h2>
                    <p className="text-muted-foreground mt-1 text-sm">
                      Backlog parts for this machine and compatible unassigned
                      parts. Reorder with the arrows.
                    </p>
                  </div>
                  {queue.error ? (
                    <ErrorDisplay error={queue.error} />
                  ) : queue.isPending ? (
                    <p role="status">Loading queue…</p>
                  ) : !queue.data.length ? (
                    <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
                      No parts queued.
                    </p>
                  ) : (
                    <ol aria-label="Machine queue" className="space-y-1.5">
                      {queue.data.map((card, index) => (
                        <li
                          key={card.id}
                          className="bg-card flex items-center gap-3 rounded-md border py-0.5 pr-1 pl-3"
                        >
                          <span
                            className="brand-figures text-muted-foreground w-6 shrink-0 text-right text-sm"
                            aria-hidden="true"
                          >
                            {index + 1}
                          </span>
                          <span
                            className="min-w-0 flex-1 truncate text-sm font-semibold"
                            title={card.title}
                          >
                            {card.title}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11 shrink-0"
                            aria-label={`Move ${card.title} up`}
                            disabled={!index || reorder.isPending}
                            onClick={() => move(index, -1)}
                          >
                            <ChevronUp aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="-ml-3 size-11 shrink-0"
                            aria-label={`Move ${card.title} down`}
                            disabled={
                              index === queue.data.length - 1 ||
                              reorder.isPending
                            }
                            onClick={() => move(index, 1)}
                          >
                            <ChevronDown aria-hidden="true" />
                          </Button>
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
              </div>
              <div className="min-w-0 space-y-6">
                <section aria-label="This week" className="space-y-3">
                  <h2 className="section-title">This week</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <p className="bg-card rounded-lg border p-4 shadow-xs">
                      <span className="brand-figures block text-3xl leading-9 font-semibold">
                        {machine.weekly_stats.done}
                      </span>{" "}
                      <span className="text-muted-foreground text-xs">
                        {machine.weekly_stats.done === 1
                          ? "part done"
                          : "parts done"}
                      </span>
                    </p>
                    <p className="bg-card rounded-lg border p-4 shadow-xs">
                      <span className="brand-figures block text-3xl leading-9 font-semibold">
                        {machine.weekly_stats.sent_back}
                      </span>{" "}
                      <span className="text-muted-foreground text-xs">
                        sent back
                      </span>
                    </p>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Since Monday, UTC. Counts distinct parts, not quantities.
                  </p>
                </section>
                <section aria-label="Last maintenance" className="space-y-3">
                  <h2 className="section-title">Last maintenance</h2>
                  <p className="bg-card rounded-lg border p-4 shadow-xs">
                    {machine.last_maintenance_at ? (
                      <time
                        dateTime={machine.last_maintenance_at}
                        title={new Date(
                          machine.last_maintenance_at
                        ).toLocaleString()}
                        className="flex flex-col"
                      >
                        <span className="font-semibold">
                          {formatDistanceToNow(
                            new Date(machine.last_maintenance_at),
                            { addSuffix: true }
                          )}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {format(
                            new Date(machine.last_maintenance_at),
                            "MMM d, yyyy"
                          )}
                        </span>
                      </time>
                    ) : (
                      <span className="text-muted-foreground text-sm">
                        No maintenance date recorded.
                      </span>
                    )}
                  </p>
                </section>
              </div>
            </div>
            <div className="border-t pt-3">
              <Button
                variant="ghost"
                className="-ml-3 min-h-11 text-[var(--emphasis)] hover:text-[var(--emphasis)] sm:min-h-9"
                onClick={() => setDeleting(true)}
              >
                <Trash2 aria-hidden="true" />
                Delete equipment
              </Button>
              {deleting && cards.isPending && (
                <p role="status">Loading linked cards…</p>
              )}
              {deleting && cards.error && <ErrorDisplay error={cards.error} />}
              {cards.isSuccess && (
                <DeleteEquipmentDialog
                  open={deleting}
                  onOpenChange={setDeleting}
                  equipment={machine}
                  assignedCount={
                    cards.data.filter((card) => card.machine_id === id).length
                  }
                  onDeleted={() => window.location.assign("/equipment")}
                />
              )}
            </div>
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
