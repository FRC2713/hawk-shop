import { latestStatusEntry } from "~/lib/statusHistory";
import { useEffect, useRef, useState } from "react";
import {
  CircleCheck,
  Hourglass,
  Pause,
  Play,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { StationPicture, StationTask } from "./StationTask";
import { StationClaim } from "./StationClaim";
import { markCardDone } from "~/lib/api/workflow";
import { queryKeys } from "~/lib/api/keys";
import { Workflow } from "./Workflow";
import { cn } from "~/lib/utils";
import { equipmentQuery, machineQueueQuery } from "~/lib/api/equipment";
import { kanbanCardDetailsQuery } from "~/lib/api/kanban";
import { processesQuery } from "~/lib/api/processes";
import { userQuery } from "~/lib/api/users";
import type { EquipmentListItem, MachineStatus } from "~/lib/equipment";
import { machineStatusLabels } from "~/lib/equipment";
import { ErrorMessage } from "~/components/mfg/ErrorDisplay";

// Local data only. Keep polling even if a kiosk browser loses its event stream.
const refresh = { refetchInterval: 180_000, refetchIntervalInBackground: true };

function CurrentPart({
  id,
  title,
  sop,
}: {
  id: string;
  title: string;
  sop?: string | null;
}) {
  const client = useQueryClient();
  const done = useMutation({
    mutationFn: () => markCardDone(id),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.kanban.cards() });
      client.invalidateQueries({ queryKey: queryKeys.equipment.all() });
    },
  });
  const details = useQuery({ ...kanbanCardDetailsQuery(id), ...refresh });
  const user = useQuery({ ...userQuery(details.data?.assignee), ...refresh });
  const entered = latestStatusEntry(
    details.data?.status_history,
    "in-progress"
  );
  return (
    <li className="station-part">
      {details.data && (
        <div className="station-current-image">
          <StationPicture key={id} card={details.data} />
        </div>
      )}
      <h4>{title}</h4>
      <p className="station-part-meta">
        <span className="station-part-who">
          {details.data?.assignee
            ? user.data?.name || "Assigned member"
            : "Unassigned"}
        </span>
        {entered ? (
          <time dateTime={entered}>
            {formatDistanceToNow(new Date(entered))} in progress
          </time>
        ) : (
          <span>Time unknown</span>
        )}
        <span>
          Qty{" "}
          <span className="brand-figures">
            {details.data?.quantity_to_make ?? "?"}
          </span>
        </span>
      </p>
      {details.data?.content && (
        <p className="station-current-notes">{details.data.content}</p>
      )}
      {!!details.data?.review_notes?.length && (
        <p className="station-task-review-flag">
          Sent back: check feedback before continuing.
        </p>
      )}
      <StationTask id={id} title={title} sop={sop} />
      <button
        className="station-control station-control--primary"
        aria-label={`Done ${title}`}
        disabled={done.isPending}
        onClick={() => done.mutate()}
      >
        <CircleCheck aria-hidden="true" />
        {done.isPending ? "Sending…" : "Done"}
      </button>
      {done.error && <ErrorMessage error={done.error} />}
      {details.error && <ErrorMessage error={details.error} />}
      {user.error && <ErrorMessage error={user.error} />}
    </li>
  );
}

function StatusIcon({
  status,
  waiting,
}: {
  status: MachineStatus;
  waiting: boolean;
}) {
  const Icon =
    status === "needs-maintenance"
      ? Wrench
      : status === "running"
        ? Play
        : waiting
          ? Hourglass
          : Pause;
  return <Icon aria-hidden="true" className="station-status-icon" />;
}

function MachineColumn({
  machine,
  processId,
}: {
  machine: EquipmentListItem;
  processId: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const [claiming, setClaiming] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const maintenance = machine.machine_status === "needs-maintenance";
  const queue = useQuery({
    ...machineQueueQuery(machine.id),
    ...refresh,
    enabled: !maintenance,
  });
  useEffect(() => {
    if (
      claiming &&
      (maintenance ||
        (queue.isSuccess &&
          !queue.data.some((card) => card.id === claiming.id)))
    )
      setClaiming(null);
  }, [claiming, maintenance, queue.isSuccess, queue.data]);
  const waiting = machine.machine_status === "idle" && !!queue.data?.length;
  const machineUrl = `/equipment/${encodeURIComponent(machine.id)}`;
  return (
    <section
      aria-label={machine.name}
      className={cn(
        "station-machine",
        waiting && "station-waiting",
        maintenance && "station-maintenance"
      )}
    >
      <header>
        <h2>
          <a href={machineUrl}>{machine.name}</a>
        </h2>
        <p
          className="station-status"
          data-status={waiting ? "waiting" : machine.machine_status}
        >
          <StatusIcon status={machine.machine_status} waiting={waiting} />
          <span>
            {machineStatusLabels[machine.machine_status]}
            {waiting && " · Work waiting"}
          </span>
        </p>
      </header>
      <div className="station-machine-work">
        {maintenance ? (
          <aside aria-label="Maintenance problem" className="station-problem">
            <h3>
              <TriangleAlert aria-hidden="true" />
              Do not use
            </h3>
            <p>
              {machine.maintenance_note ||
                "A problem has been reported. Check with a mentor."}
            </p>
            {machine.maintenance_reported_by && (
              <p>Reported by {machine.maintenance_reported_by}</p>
            )}
          </aside>
        ) : (
          <>
            <h3>Now</h3>
            {machine.current_parts.length ? (
              <ul className="station-current">
                {machine.current_parts.map((part) => (
                  <CurrentPart
                    key={part.id}
                    {...part}
                    sop={machine.documentation_url}
                  />
                ))}
              </ul>
            ) : (
              <p className="station-empty">No part in progress.</p>
            )}
            <h3>Up next</h3>
            {queue.error ? (
              <ErrorMessage error={queue.error} />
            ) : queue.isPending ? (
              <p role="status" className="station-empty">
                Loading queue…
              </p>
            ) : queue.data.length ? (
              <>
                <ol aria-label="Up next" className="station-queue">
                  {queue.data
                    .slice(0, showAll ? undefined : 3)
                    .map((card, index) => (
                      <li key={card.id}>
                        <span className="station-queue-position brand-figures">
                          {index + 1}
                        </span>
                        <span className="station-queue-title">
                          {card.title}
                        </span>
                        <span className="station-queue-qty">
                          Qty{" "}
                          <span className="brand-figures">
                            {card.quantity_to_make ?? "?"}
                          </span>
                        </span>
                        <div className="station-queue-actions">
                          <StationTask
                            id={card.id}
                            title={card.title}
                            sop={machine.documentation_url}
                          />
                          <button
                            className="station-control station-control--secondary"
                            aria-label={`Claim ${card.title}`}
                            onClick={() => setClaiming(card)}
                          >
                            Claim
                          </button>
                        </div>
                      </li>
                    ))}
                </ol>
                {queue.data.length > 3 && (
                  <button
                    className="station-control station-control--ghost station-more"
                    aria-expanded={showAll}
                    onClick={() => setShowAll(!showAll)}
                  >
                    {showAll
                      ? "Show fewer parts"
                      : `Show all ${queue.data.length} queued parts`}
                  </button>
                )}
              </>
            ) : (
              <p className="station-empty">No parts queued.</p>
            )}
          </>
        )}
      </div>
      {claiming && (
        <StationClaim
          processId={processId}
          machine={machine}
          card={claiming}
          close={() => setClaiming(null)}
        />
      )}
      <a
        className="station-control station-control--ghost station-sop"
        href={machine.documentation_url || `${machineUrl}/edit`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {machine.documentation_url ? "Open SOP" : "Add SOP link"}
      </a>
    </section>
  );
}

export function StationContent({ processId }: { processId: string | null }) {
  const processes = useQuery({ ...processesQuery(), ...refresh });
  const equipment = useQuery({ ...equipmentQuery(), ...refresh });
  const [changing, setChanging] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  const process = processes.data?.find((item) => item.id === processId);
  const machines = equipment.data
    ?.filter((item) => item.processes.some((p) => p.id === processId))
    .sort((a, b) => a.name.localeCompare(b.name));
  // A chosen station keeps its columns; the picker floats over them.
  const overlay = !!process;
  const pickerOpen = changing || !process;
  useEffect(() => {
    if (!changing || !overlay) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setChanging(false);
      toggle.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [changing, overlay]);
  const machineCount = (id: string) =>
    equipment.data?.filter((item) => item.processes.some((p) => p.id === id))
      .length;
  const stations = processes.data
    ?.map((item) => ({ ...item, count: machineCount(item.id) }))
    .sort((a, b) => Number(!a.count) - Number(!b.count));
  return (
    <main className="station-screen">
      <header className="station-header">
        <div className="station-heading">
          <img
            src="/brand/2713-white.svg"
            alt="Red Hawk Robotics 2713"
            width="83"
            height="24"
          />
          <div>
            <h1>{process?.name || "Choose a station"}</h1>
            {!processId && (
              <p className="station-help">
                Pick the process this screen shows. Each machine that does it
                gets a column.
              </p>
            )}
          </div>
        </div>
        <div className="station-controls">
          <a
            className="station-control station-control--ghost"
            href="/equipment"
          >
            Equipment
          </a>
          {processId && (
            <button
              ref={toggle}
              className="station-control station-control--ghost station-toggle"
              aria-expanded={pickerOpen}
              aria-controls="station-picker"
              onClick={() => setChanging(!changing)}
            >
              Change station
            </button>
          )}
        </div>
        {pickerOpen && (
          <nav
            id="station-picker"
            aria-label="Stations"
            className={cn(
              "station-picker",
              overlay && "station-picker--overlay"
            )}
          >
            {stations?.map((item) => (
              <a
                className={cn(
                  "station-tile",
                  !item.count && "station-tile--empty"
                )}
                href={`/station/${encodeURIComponent(item.id)}`}
                key={item.id}
                aria-label={item.name}
                aria-describedby={`station-count-${item.id}`}
                aria-current={item.id === processId ? "page" : undefined}
              >
                <span className="station-tile-name">{item.name}</span>
                <span
                  className="station-tile-count"
                  id={`station-count-${item.id}`}
                >
                  {item.count === undefined ? (
                    "Machines loading"
                  ) : item.count ? (
                    <>
                      <span className="brand-figures">{item.count}</span>{" "}
                      {item.count === 1 ? "machine" : "machines"}
                    </>
                  ) : (
                    "No machines yet"
                  )}
                </span>
              </a>
            ))}
            {processes.isSuccess && !processes.data.length && (
              <p>No processes yet. Add a process in Equipment.</p>
            )}
          </nav>
        )}
      </header>
      {processes.error && <ErrorMessage error={processes.error} />}
      {equipment.error && <ErrorMessage error={equipment.error} />}
      {(processes.isPending || equipment.isPending) && (
        <p role="status">Loading station…</p>
      )}
      {processId && processes.isSuccess && !process && (
        <p role="alert" className="station-alert">
          Station not found. Choose another process.
        </p>
      )}
      {process && equipment.isSuccess && !machines?.length && (
        <p>
          No machines use this process. Assign it to a machine in Equipment.
        </p>
      )}
      {process && (
        <div className="station-columns">
          {machines?.map((machine) => (
            <MachineColumn
              key={machine.id}
              machine={machine}
              processId={process.id}
            />
          ))}
        </div>
      )}
    </main>
  );
}

export default function Station(props: { processId: string | null }) {
  return (
    <Workflow>
      <StationContent {...props} />
    </Workflow>
  );
}
