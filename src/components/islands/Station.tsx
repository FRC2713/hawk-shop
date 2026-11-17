import { latestStatusEntry } from "~/lib/statusHistory";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { StationClaim } from "./StationClaim";
import { markCardDone } from "~/lib/api/workflow";
import { queryKeys } from "~/lib/api/keys";
import { Workflow } from "./Workflow";
import { cn } from "~/lib/utils";
import { equipmentQuery, machineQueueQuery } from "~/lib/api/equipment";
import { kanbanCardDetailsQuery } from "~/lib/api/kanban";
import { processesQuery } from "~/lib/api/processes";
import { userQuery } from "~/lib/api/users";
import type { EquipmentListItem } from "~/lib/equipment";
import { machineStatusLabels } from "~/lib/equipment";
import { ErrorMessage } from "~/components/mfg/ErrorDisplay";

// Local data only. Keep polling even if a kiosk browser loses its event stream.
const refresh = { refetchInterval: 180_000, refetchIntervalInBackground: true };

function CurrentPart({ id, title }: { id: string; title: string }) {
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
      <h4>{title}</h4>
      <p>
        {details.data?.assignee
          ? user.data?.name || "Assigned member"
          : "Unassigned"}
      </p>
      <p>
        {entered ? (
          <time dateTime={entered}>
            {formatDistanceToNow(new Date(entered))} in progress
          </time>
        ) : (
          "Time in status unknown"
        )}
      </p>
      <p>
        Quantity:{" "}
        <span className="brand-figures">
          {details.data?.quantity_to_make ?? "Unknown"}
        </span>
      </p>
      <button
        className="station-control"
        aria-label={`Done ${title}`}
        disabled={done.isPending}
        onClick={() => done.mutate()}
      >
        {done.isPending ? "Sending…" : "Done"}
      </button>
      {done.error && <ErrorMessage error={done.error} />}
      {details.error && <ErrorMessage error={details.error} />}
      {user.error && <ErrorMessage error={user.error} />}
    </li>
  );
}

function MachineColumn({
  machine,
  processId,
}: {
  machine: EquipmentListItem;
  processId: string;
}) {
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
        <p className="station-status">
          {machineStatusLabels[machine.machine_status]}
          {waiting && " · Work waiting"}
        </p>
      </header>
      <div className="station-machine-work">
        {maintenance ? (
          <aside aria-label="Maintenance problem">
            <h3>Do not use</h3>
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
                  <CurrentPart key={part.id} {...part} />
                ))}
              </ul>
            ) : (
              <p>No part in progress.</p>
            )}
            <h3>Up next</h3>
            {queue.error ? (
              <ErrorMessage error={queue.error} />
            ) : queue.isPending ? (
              <p role="status">Loading queue…</p>
            ) : queue.data.length ? (
              <>
                <ol aria-label="Up next" className="station-queue">
                  {queue.data.slice(0, 3).map((card) => (
                    <li key={card.id}>
                      <span>{card.title}</span>
                      <span className="brand-figures">
                        Qty {card.quantity_to_make ?? "?"}
                      </span>
                      <button
                        className="station-control"
                        aria-label={`Claim ${card.title}`}
                        onClick={() => setClaiming(card)}
                      >
                        Claim
                      </button>
                    </li>
                  ))}
                </ol>
                {queue.data.length > 3 && (
                  <p>{queue.data.length - 3} more queued</p>
                )}
              </>
            ) : (
              <p>No parts queued.</p>
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
        className="station-control station-sop"
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
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  const process = processes.data?.find((item) => item.id === processId);
  const machines = equipment.data
    ?.filter((item) => item.processes.some((p) => p.id === processId))
    .sort((a, b) => a.name.localeCompare(b.name));
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
          <h1>{process?.name || "Choose a station"}</h1>
        </div>
        <div className="station-controls">
          <a className="station-control" href="/equipment">
            Equipment
          </a>
          <button
            className="station-control"
            aria-expanded={changing}
            aria-controls="station-picker"
            onClick={() => setChanging(!changing)}
          >
            Change station
          </button>
        </div>
      </header>
      {(changing || !processId) && (
        <nav
          id="station-picker"
          aria-label="Stations"
          className="station-picker"
        >
          {processes.data?.map((item) => (
            <a
              className="station-control"
              href={`/station/${encodeURIComponent(item.id)}`}
              key={item.id}
              aria-current={item.id === processId ? "page" : undefined}
            >
              {item.name}
            </a>
          ))}
          {processes.isSuccess && !processes.data.length && (
            <p>No processes yet. Add a process in Equipment.</p>
          )}
        </nav>
      )}
      {processes.error && <ErrorMessage error={processes.error} />}
      {equipment.error && <ErrorMessage error={equipment.error} />}
      {(processes.isPending || equipment.isPending) && (
        <p role="status">Loading station…</p>
      )}
      {processId && processes.isSuccess && !process && (
        <p role="alert">
          Station not found. Use Change station to choose a process.
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
