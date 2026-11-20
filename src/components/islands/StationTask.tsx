import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, ImageOff, Maximize2, X } from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  kanbanCardDetailsQuery,
  type KanbanCardWithHistory,
} from "~/lib/api/kanban";
import { cardThumbnailUrl } from "~/lib/api/onshape";
import { cardOnshapeUrl } from "~/lib/onshapeLinks";
import { userQuery } from "~/lib/api/users";
import { ErrorMessage } from "~/components/mfg/ErrorDisplay";

type PictureCard = Parameters<typeof cardThumbnailUrl>[0];

export function StationPicture({ card }: { card: PictureCard }) {
  const [failed, setFailed] = useState(false);
  const source = cardThumbnailUrl(card);
  return source && !failed ? (
    <img
      className="station-task-image"
      src={source}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="station-task-no-image">
      <ImageOff aria-hidden="true" />
      No image available
    </span>
  );
}

export function StationTask({
  id,
  title,
  sop,
}: {
  id: string;
  title: string;
  sop?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const details = useQuery({
    ...kanbanCardDetailsQuery(id),
    enabled: open,
    retry: false,
    refetchInterval: open ? 180_000 : false,
    refetchIntervalInBackground: true,
  });
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        className="station-control station-control--secondary"
        aria-label={`Build details for ${title}`}
      >
        <Maximize2 aria-hidden="true" />
        Build details
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="station-claim-overlay" />
        <Dialog.Content className="station-claim station-task">
          <header className="station-task-header">
            <div>
              <p className="station-task-eyebrow">Build reference</p>
              <Dialog.Title className="station-claim-title">
                {title}
              </Dialog.Title>
              <Dialog.Description>
                Check the model and instructions before you start.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="station-control"
              aria-label="Close build details"
            >
              <X aria-hidden="true" />
            </Dialog.Close>
          </header>
          {details.isPending && <p role="status">Loading build details…</p>}
          {details.error && <ErrorMessage error={details.error} cardId={id} />}
          {details.data && (
            <TaskReference key={id} card={details.data} sop={sop} />
          )}
          <Dialog.Close className="station-control station-control--primary station-claim-cancel">
            Back to station
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TaskReference({
  card,
  sop,
}: {
  card: KanbanCardWithHistory;
  sop?: string | null;
}) {
  const submitter = useQuery(userQuery(card.created_by));
  const assignee = useQuery(userQuery(card.assignee));
  const onshape = cardOnshapeUrl(card);
  const [enlarged, setEnlarged] = useState(false);
  return (
    <>
      <div className="station-task-grid">
        <div className="station-task-visual">
          <button
            className="station-task-picture"
            aria-label={enlarged ? "Reduce image" : "Enlarge image"}
            aria-expanded={enlarged}
            onClick={() => setEnlarged(!enlarged)}
            data-enlarged={enlarged}
          >
            <StationPicture card={card} />
          </button>
          <p className="station-task-hint">
            Tap the image to enlarge. Open Onshape for dimensions and model
            views.
          </p>
          <div className="station-task-links">
            {onshape ? (
              <a
                className="station-control station-control--secondary"
                href={onshape}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in Onshape
                <ExternalLink aria-hidden="true" />
              </a>
            ) : (
              <p>No Onshape model linked.</p>
            )}
            {sop && (
              <a
                className="station-control station-control--secondary"
                href={sop}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open SOP
                <ExternalLink aria-hidden="true" />
              </a>
            )}
            <a
              className="station-control station-control--ghost"
              href={`/parts/${encodeURIComponent(card.id)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Full card & history
              <ExternalLink aria-hidden="true" />
            </a>
          </div>
        </div>
        <div className="station-task-instructions">
          <dl className="station-task-facts">
            {[
              ["Quantity to make", card.quantity_to_make ?? "Not set"],
              ["Material", card.onshape_material ?? "Unknown"],
              ["Project", card.project?.name ?? "Not set"],
              ["Released version", card.onshape_version_name ?? "Unknown"],
              [
                "Due",
                card.due_date
                  ? format(parseISO(card.due_date), "EEE, MMM d, yyyy")
                  : "No due date",
              ],
              [
                "Assignee",
                card.assignee
                  ? assignee.data?.name || "Assigned member"
                  : "Nobody yet",
              ],
              [
                "Processes",
                card.processes?.map((p) => p.name).join(", ") || "None",
              ],
              ["Submitter", submitter.data?.name || "Unknown member"],
            ].map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value === "" ? "Not set" : value}</dd>
              </div>
            ))}
          </dl>
          <section className="station-task-notes" aria-label="Submitter notes">
            <h3>Submitter notes</h3>
            <p>
              {card.content ||
                "No submitter notes. Ask the submitter or a mentor if instructions are missing."}
            </p>
          </section>
          {!!card.review_notes?.length && (
            <section
              className="station-task-notes station-task-warning"
              aria-label="Send back feedback"
            >
              <h3>Send back feedback</h3>
              {card.review_notes.map((note) => (
                <div key={note.id}>
                  <p>{note.text}</p>
                  <p className="station-task-hint">{note.author_name}</p>
                </div>
              ))}
            </section>
          )}
          {!!card.release_issues?.length && (
            <section
              className="station-task-notes station-task-warning"
              aria-label="Release warnings"
            >
              <h3>Release warnings</h3>
              {card.release_issues.map((issue, index) => (
                <div key={index}>
                  <p>{issue.message}</p>
                  {issue.fix && <p>{issue.fix}</p>}
                </div>
              ))}
            </section>
          )}
          {submitter.error && <ErrorMessage error={submitter.error} />}
          {assignee.error && <ErrorMessage error={assignee.error} />}
        </div>
      </div>
    </>
  );
}
