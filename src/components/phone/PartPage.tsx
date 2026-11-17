import { useState, type MouseEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, EllipsisVertical } from "lucide-react";
import {
  deleteKanbanCard,
  equipmentQuery,
  kanbanCardDetailsQuery,
  kanbanCardSnapshotQuery,
  usersQuery,
  ApiError,
  type KanbanCardWithHistory,
} from "~/lib/api";
import { cardThumbnailUrl } from "~/lib/api/onshape";
import { openProblemReport } from "~/lib/api/reports";
import { cardMachineName, unlinkedMachineText } from "~/lib/cardMachine";
import { cardOnshapeUrl } from "~/lib/onshapeLinks";
import { PHONE_HOME } from "~/lib/phone";
import { memberName } from "~/lib/phoneParts";
import { loadState } from "./LoadState";
import { ErrorMessage } from "~/components/mfg/ErrorDisplay";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "~/components/ui/dialog";
import { StatusBar } from "./StatusBar";
import { PartActionBar } from "./PartActionBar";

type PartPageProps = {
  cardId: string;
  /** The signed-in member's Suite subject. */
  viewerId: string;
};

/**
 * The phone part page: everything about one part, with the action for its
 * status pinned at the bottom (`PartActionBar`) and rare actions in an
 * overflow menu. Reads the card through `kanbanCardDetailsQuery`, so live
 * board events refresh it.
 */
export function PartPage({ cardId, viewerId }: PartPageProps) {
  const details = useQuery(kanbanCardDetailsQuery(cardId));
  if (details.error instanceof ApiError && details.error.status === 404)
    return (
      <PartShell>
        <section role="alert" className="space-y-2 p-4">
          <h1 className="text-2xl">Part not found</h1>
          <p>It may have been deleted.</p>
        </section>
      </PartShell>
    );
  const pending = loadState([details], "Loading part...", {
    title: "Unable to load this part",
    cardId,
  });
  if (pending || !details.data)
    return (
      <PartShell>
        <div className="p-4">{pending}</div>
      </PartShell>
    );
  return <PartDetails card={details.data} viewerId={viewerId} />;
}

function PartDetails({
  card,
  viewerId,
}: {
  card: KanbanCardWithHistory;
  viewerId: string;
}) {
  const { data: users = [] } = useQuery(usersQuery());
  const { data: equipment = [] } = useQuery(equipmentQuery());
  const snapshot = useQuery(kanbanCardSnapshotQuery(card));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pictureOpen, setPictureOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pictureFailed, setPictureFailed] = useState(false);
  const deletion = useMutation({
    mutationFn: () => deleteKanbanCard(card.id),
    onSuccess: () => window.location.assign(PHONE_HOME),
    onError: (error) =>
      toast.error("Failed to delete part", {
        description: <ErrorMessage error={error} cardId={card.id} />,
      }),
  });

  const nameOf = (subject: string | null) => memberName(users, subject);
  const submitter = nameOf(card.created_by);
  const machine = cardMachineName(card) ?? unlinkedMachineText(card);
  const processes = card.processes ?? [];
  const sop = equipment.find(
    (item) => item.id === card.machine_id
  )?.documentation_url;
  const material =
    card.onshape_material ?? snapshot.data?.onshape_material ?? null;
  const versionName =
    card.onshape_version_name ?? snapshot.data?.onshape_version_name ?? null;
  const onshapeUrl = cardOnshapeUrl(card);
  const picture = pictureFailed ? undefined : cardThumbnailUrl(card);
  const history = card.status_history;

  const byline = [
    card.project?.name,
    versionName,
    submitter &&
      `released by ${submitter}, ${format(parseISO(card.date_created), "MMM d")}`,
  ].filter(Boolean);

  return (
    <PartShell
      menu={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label="More actions"
            >
              <EllipsisVertical className="size-5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="min-h-11"
              onSelect={() => openProblemReport({ card_id: card.id })}
            >
              Report a problem
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive min-h-11"
              disabled={deletion.isPending}
              onSelect={() => setConfirmDelete(true)}
            >
              Delete part
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      footer={<PartActionBar card={card} viewerId={viewerId} />}
    >
      <main data-report-card-id={card.id} className="flex flex-col gap-4 p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl leading-tight break-words">{card.title}</h1>
            {byline.length > 0 && (
              <p className="text-muted-foreground text-sm">
                {byline.join(" · ")}
              </p>
            )}
          </div>
          {picture && (
            <button
              type="button"
              aria-label="Enlarge picture"
              onClick={() => setPictureOpen(true)}
              className="bg-muted size-18 flex-none overflow-hidden rounded-lg border"
            >
              <img
                src={picture}
                alt=""
                width={72}
                height={72}
                className="size-full object-contain"
                onError={() => setPictureFailed(true)}
              />
            </button>
          )}
        </div>

        <StatusBar columnId={card.column_id} />

        <dl className="bg-border grid grid-cols-2 gap-px overflow-hidden rounded-xl border">
          <Fact name="Quantity" figure={card.quantity_to_make != null}>
            {card.quantity_to_make ?? "Not set"}
          </Fact>
          <Fact name="Material">
            {material === null
              ? snapshot.isPending && snapshot.fetchStatus !== "idle"
                ? "Loading..."
                : "Unknown"
              : material || "Not set"}
          </Fact>
          <Fact name="Machine">
            {machine ??
              (processes.length ? `Any ${processes[0].name}` : "Not assigned")}
          </Fact>
          <Fact name="Process">
            {processes.map((process) => process.name).join(", ") || "None"}
          </Fact>
          <Fact name="Made by">
            {memberName(users, card.assignee, viewerId) ?? "Nobody yet"}
          </Fact>
          <Fact name="Due">
            {card.due_date
              ? format(parseISO(card.due_date), "EEE, MMM d")
              : "No due date"}
          </Fact>
        </dl>

        {!!card.review_notes?.length && (
          <Callout
            label="Sent back"
            rail="red"
            items={card.review_notes.map((note) => ({
              key: note.id,
              text: note.text,
              detail: note.author_name,
            }))}
          />
        )}

        {card.content && (
          <Callout
            label={`Notes from ${submitter ?? "the submitter"}`}
            rail="teal"
            items={[{ key: "notes", text: card.content }]}
          />
        )}

        {!!card.release_issues?.length && (
          <Callout
            label="Release warnings"
            rail="red"
            items={card.release_issues.map((issue, index) => ({
              key: `${issue.code}-${index}`,
              text: issue.message,
              detail: issue.fix,
            }))}
          />
        )}

        <div className="flex flex-col">
          {sop && machine && (
            <LinkRow href={sop} hint="Procedure" external>
              {machine} SOP
            </LinkRow>
          )}
          {onshapeUrl && (
            <LinkRow href={onshapeUrl} hint={versionName ?? undefined} external>
              Open in Onshape
            </LinkRow>
          )}
          <button
            type="button"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((open) => !open)}
            className="flex min-h-11 items-center justify-between gap-3 text-left"
          >
            History
            <span className="text-muted-foreground flex items-center gap-1 text-xs">
              {history.length === 1 ? "1 change" : `${history.length} changes`}
              <ChevronRight
                aria-hidden="true"
                className={historyOpen ? "size-4 rotate-90" : "size-4"}
              />
            </span>
          </button>
          {historyOpen && (
            <section aria-label="Status history">
              <ol className="divide-y rounded-lg border">
                {history.map((entry) => (
                  <li key={entry.id} className="space-y-1 px-4 py-3 text-sm">
                    <p className="font-semibold break-words">
                      {entry.from_status === null
                        ? `Released into ${entry.to_status}`
                        : `${entry.from_status} → ${entry.to_status}`}
                    </p>
                    <p className="text-muted-foreground break-words">
                      {entry.actor_name}
                    </p>
                    <time
                      dateTime={entry.moved_at}
                      className="brand-figures text-muted-foreground block text-xs"
                    >
                      {new Date(entry.moved_at).toLocaleString()}
                    </time>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </main>

      <Dialog open={pictureOpen} onOpenChange={setPictureOpen}>
        <DialogContent className="p-3">
          <DialogTitle className="pr-8">{card.title}</DialogTitle>
          <DialogDescription className="sr-only">
            Model picture
          </DialogDescription>
          {picture && (
            <img
              src={picture}
              alt={`Model of ${card.title}`}
              style={{ width: "100%" }}
              className="max-h-[70dvh] object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this part?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{card.title}". This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletion.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 min-h-11"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PartShell>
  );
}

/** Header with a back link and an optional menu; footer pinned below. */
function PartShell({
  menu,
  footer,
  children,
}: {
  menu?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col lg:min-h-0">
      <header className="bg-card sticky top-0 z-30 flex items-center justify-between border-b px-2 py-1">
        <a
          href={PHONE_HOME}
          onClick={goBack}
          className="text-foreground flex min-h-11 items-center gap-1 px-2 font-semibold no-underline"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
          Back
        </a>
        {menu}
      </header>
      <div className="flex-1">{children}</div>
      <footer
        aria-label="Part actions"
        className="bg-card sticky bottom-0 z-30 flex gap-2 border-t px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] empty:hidden"
      >
        {footer}
      </footer>
    </div>
  );
}

/** Back to the list the member came from, else the first tab. */
function goBack(event: MouseEvent<HTMLAnchorElement>) {
  let sameOrigin = false;
  try {
    sameOrigin = new URL(document.referrer).origin === window.location.origin;
  } catch {}
  if (sameOrigin && window.history.length > 1) {
    event.preventDefault();
    window.history.back();
  }
}

function Fact({
  name,
  figure,
  children,
}: {
  name: string;
  figure?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="bg-card px-3 py-2.5">
      <dt className="text-muted-foreground font-sans text-xs">{name}</dt>
      <dd
        data-fact={name}
        className={
          figure
            ? "brand-figures text-xl font-bold"
            : "font-semibold break-words"
        }
      >
        {children}
      </dd>
    </div>
  );
}

function Callout({
  label,
  rail,
  items,
}: {
  label: string;
  rail: "red" | "teal";
  items: { key: string | number; text: string; detail?: string | null }[];
}) {
  return (
    <section
      aria-label={label}
      className={
        "bg-muted rounded-lg border-l-4 px-3.5 py-3 " +
        (rail === "red" ? "border-l-primary" : "border-l-status-active")
      }
    >
      <h2 className="font-semibold">{label}</h2>
      <ul className="mt-1 space-y-2 text-sm">
        {items.map((item) => (
          <li key={item.key}>
            <p className="break-words whitespace-pre-wrap">{item.text}</p>
            {item.detail && (
              <p className="text-muted-foreground">{item.detail}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function LinkRow({
  href,
  hint,
  external,
  children,
}: {
  href: string;
  hint?: string;
  external?: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="text-foreground flex min-h-11 items-center justify-between gap-3 border-b no-underline"
    >
      <span className="min-w-0 break-words">{children}</span>
      {hint && (
        <span className="text-muted-foreground shrink-0 text-xs">{hint}</span>
      )}
    </a>
  );
}
