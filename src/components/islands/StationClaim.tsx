import { renderSVG } from "uqr";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { usersQuery } from "~/lib/api/users";
import { queryKeys } from "~/lib/api/keys";
import { claimCard } from "~/lib/api/workflow";
import {
  stationRosterQuery,
  removeStationMember,
  pickStationMember,
  type StationMember,
} from "~/lib/api/stationRoster";
import { ErrorMessage } from "~/components/mfg/ErrorDisplay";

function MemberButton({
  member,
  roster,
  disabled,
  pick,
  remove,
}: {
  member: StationMember;
  roster: boolean;
  disabled: boolean;
  pick: () => void;
  remove: () => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(() => cancel, []);
  return (
    <button
      className="station-control"
      disabled={disabled}
      aria-describedby={roster ? "station-remove-help" : undefined}
      onPointerDown={(event) => {
        held.current = false;
        if (!roster || event.button !== 0) return;
        timer.current = setTimeout(() => {
          held.current = true;
          remove();
        }, 700);
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onContextMenu={(event) => {
        if (roster) {
          event.preventDefault();
          cancel();
          held.current = true;
          remove();
        }
      }}
      onKeyDown={(event) => {
        if (roster && (event.key === "Delete" || event.key === "Backspace")) {
          event.preventDefault();
          cancel();
          remove();
        }
      }}
      onClick={() => {
        cancel();
        if (!held.current) pick();
        held.current = false;
      }}
    >
      {member.name || "Unknown member"}
    </button>
  );
}

export function StationClaim({
  processId,
  machine,
  card,
  close,
}: {
  processId: string;
  machine: { id: string; name: string };
  card: { id: string; title: string };
  close: () => void;
}) {
  const opener = useRef(
    typeof document === "undefined"
      ? null
      : (document.activeElement as HTMLElement | null)
  );
  // This dialog only opens after a click, so the browser supplies the public origin.
  const phoneUrl = useMemo(() => {
    const url = new URL(
      `/parts/${encodeURIComponent(card.id)}`,
      window.location.origin
    );
    url.searchParams.set("intent", "claim");
    url.searchParams.set("machineId", machine.id);
    return url.href;
  }, [card.id, machine.id]);
  const qrSource = useMemo(
    () =>
      `data:image/svg+xml,${encodeURIComponent(renderSVG(phoneUrl, { border: 4, ecc: "M" }))}`,
    [phoneUrl]
  );
  const client = useQueryClient();
  const roster = useQuery({
    ...stationRosterQuery(processId),
    refetchInterval: 180_000,
    refetchIntervalInBackground: true,
  });
  const users = useQuery(usersQuery());
  const [search, setSearch] = useState("");
  const [removing, setRemoving] = useState<StationMember | null>(null);
  const claim = useMutation({
    mutationFn: async (userId: string) => {
      const today = await pickStationMember(processId, userId);
      client.setQueryData(queryKeys.kanban.stationRoster(processId), today);
      return claimCard(card.id, { machineId: machine.id, userId });
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.kanban.cards() });
      client.invalidateQueries({ queryKey: queryKeys.equipment.all() });
      close();
    },
  });
  const removal = useMutation({
    mutationFn: (member: StationMember) =>
      removeStationMember(processId, member.onshape_user_id),
    onSuccess: (data) => {
      client.setQueryData(queryKeys.kanban.stationRoster(processId), data);
      setRemoving(null);
    },
  });
  const busy = claim.isPending || removal.isPending;
  const term = search.trim().toLocaleLowerCase();
  const members = term
    ? users.data?.filter((m) =>
        (m.name || "").toLocaleLowerCase().includes(term)
      )
    : roster.data?.members;
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="station-claim-overlay" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
          className="station-claim"
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <Dialog.Title>Who's making this?</Dialog.Title>
          <Dialog.Description>
            {card.title} · {machine.name}
          </Dialog.Description>
          <div className="station-claim-options">
            <div className="station-claim-members">
              <label htmlFor="station-member-search">Search all members</label>
              <input
                id="station-member-search"
                value={search}
                disabled={busy}
                onChange={(e) => setSearch(e.target.value)}
              />
              <h3>{term ? "Matching members" : "At this station today"}</h3>
              <p id="station-remove-help">
                Hold a name to remove it from today's list, or focus it and
                press Delete.
              </p>
              {removing ? (
                <section aria-label="Remove member">
                  <p>
                    Remove {removing.name || "this member"} from today's list?
                  </p>
                  <button
                    className="station-control"
                    disabled={busy}
                    autoFocus
                    onClick={() => removal.mutate(removing)}
                  >
                    Remove name
                  </button>
                  <button
                    className="station-control"
                    disabled={busy}
                    onClick={() => setRemoving(null)}
                  >
                    Cancel removal
                  </button>
                </section>
              ) : (
                <div className="station-members">
                  {members?.map((member) => (
                    <MemberButton
                      key={member.onshape_user_id}
                      member={member}
                      disabled={busy}
                      roster={
                        !!roster.data?.members.some(
                          (m) => m.onshape_user_id === member.onshape_user_id
                        )
                      }
                      pick={() => claim.mutate(member.onshape_user_id)}
                      remove={() => setRemoving(member)}
                    />
                  ))}
                  {members?.length === 0 && (
                    <p>
                      {term
                        ? "No members found."
                        : "No one here yet. Search for your name."}
                    </p>
                  )}
                </div>
              )}
              {(term ? users.isPending : roster.isPending) && (
                <p role="status">Loading members…</p>
              )}
              {roster.error && <ErrorMessage error={roster.error} />}
              {users.error && <ErrorMessage error={users.error} />}
              {claim.error && <ErrorMessage error={claim.error} />}
              {removal.error && <ErrorMessage error={removal.error} />}
            </div>
            <aside
              className="station-claim-phone"
              aria-label="Claim on your phone"
            >
              <h3>Use your own phone</h3>
              <img
                src={qrSource}
                width={256}
                height={256}
                alt="Scan to claim on your phone"
              />
              <p>Scan, sign in as yourself, then tap Claim.</p>
              <a className="station-control" href={phoneUrl}>
                Open on your phone
              </a>
            </aside>
          </div>
          <button className="station-control" disabled={busy} onClick={close}>
            Cancel claim
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
