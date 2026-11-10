import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { ExternalLink, Image as ImageIcon, Loader2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import {
  clearEquipmentMaintenance,
  flagEquipmentMaintenance,
  needsMaintenance,
  queryKeys,
  type EquipmentWithProcesses,
  type KanbanCardWithProcesses,
} from "~/lib/api";
import { EquipmentImageLightbox } from "./EquipmentImageLightbox";

interface EquipmentDetailPanelProps {
  equipment: EquipmentWithProcesses;
  assignedCards: KanbanCardWithProcesses[];
  columnTitles: Map<string, string>;
  onEdit: () => void;
  onDelete: () => void;
}

function shortDate(iso: string | null | undefined) {
  if (!iso) return null;
  try {
    return format(parseISO(iso), "EEE, MMM d");
  } catch {
    return null;
  }
}

function cardThumbnail(card: KanbanCardWithProcesses) {
  if (!card.image_url && !card.onshape_document_id) return null;
  const version = card.onshape_microversion_id
    ? `&microversionId=${encodeURIComponent(card.onshape_microversion_id)}`
    : "";
  return `/api/onshape/thumbnail?cardId=${card.id}${version}`;
}

function AssignedPart({
  card,
  columnTitle,
}: {
  card: KanbanCardWithProcesses;
  columnTitle?: string;
}) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const thumbnail = cardThumbnail(card);
  const due = shortDate(card.due_date);
  return (
    <li className="flex items-center gap-3 border-t py-2">
      <span className="bg-muted flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-sm border">
        {thumbnail && !thumbnailFailed ? (
          <img
            src={thumbnail}
            alt=""
            className="size-full object-contain"
            loading="lazy"
            onError={() => setThumbnailFailed(true)}
          />
        ) : (
          <ImageIcon
            className="text-muted-foreground size-4"
            aria-hidden="true"
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <a
          href={`/kanban?cardId=${encodeURIComponent(card.id)}`}
          className="brand-figures block truncate text-[13px] font-bold text-[var(--foreground)] underline-offset-2 hover:underline"
        >
          {card.title}
        </a>
        <span className="text-muted-foreground block truncate text-xs">
          {[
            columnTitle,
            card.quantity_to_make && `make ${card.quantity_to_make}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <span className="text-muted-foreground text-xs whitespace-nowrap">
        {due ? `Due ${due}` : "No due date"}
      </span>
    </li>
  );
}

export function EquipmentDetailPanel({
  equipment,
  assignedCards,
  columnTitles,
  onEdit,
  onDelete,
}: EquipmentDetailPanelProps) {
  const queryClient = useQueryClient();
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState("");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const images = equipment.image_urls ?? [];
  const flagged = needsMaintenance(equipment);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.equipment.all() });

  const flag = useMutation({
    mutationFn: () => flagEquipmentMaintenance(equipment.id, note.trim()),
    onSuccess: async () => {
      await refresh();
      setReporting(false);
      setNote("");
      toast.success(`${equipment.name} flagged for maintenance`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const clear = useMutation({
    mutationFn: () => clearEquipmentMaintenance(equipment.id),
    onSuccess: async () => {
      await refresh();
      toast.success(`Maintenance flag cleared on ${equipment.name}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reportedOn = shortDate(equipment.maintenance_reported_at);

  return (
    <>
      {images.length > 0 ? (
        <div className="flex flex-col gap-1 border-b">
          <button
            type="button"
            onClick={() => setLightboxIndex(0)}
            className="bg-muted block h-48 w-full overflow-hidden outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--ring)]/50 focus-visible:ring-inset"
            aria-label={`View photos of ${equipment.name}`}
          >
            <img src={images[0]} alt="" className="size-full object-cover" />
          </button>
          {images.length > 1 && (
            <div className="flex gap-1 overflow-x-auto px-1 pb-1">
              {images.slice(1).map((url, index) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setLightboxIndex(index + 1)}
                  aria-label={`View photo ${index + 2} of ${images.length}`}
                  className="size-12 shrink-0 overflow-hidden rounded-sm border outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--ring)]/50"
                >
                  <img src={url} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-muted text-muted-foreground flex h-32 flex-col items-center justify-center gap-1 border-b text-xs">
          <ImageIcon className="size-5" aria-hidden="true" />
          No photos yet. Add some with Edit.
        </div>
      )}

      <div className="flex flex-col gap-4 px-6 pt-4 pb-6">
        <div>
          <h2 className="text-xl leading-7">{equipment.name}</h2>
          <p className="text-muted-foreground text-xs">
            {equipment.location?.trim() || "No location"}
          </p>
        </div>

        {(equipment.processes?.length ?? 0) > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Processes">
            {equipment.processes!.map((process) => (
              <li
                key={process.id}
                className="rounded-full border px-2.5 py-0.5 text-xs"
              >
                {process.name}
              </li>
            ))}
          </ul>
        )}

        {equipment.description && (
          <p className="text-sm whitespace-pre-line">{equipment.description}</p>
        )}

        {flagged && (
          <div className="bg-muted flex flex-col gap-1 rounded-r-lg border-l-4 border-[var(--primary)] px-3.5 py-3">
            <h3 className="text-base text-[var(--emphasis)]">
              Needs maintenance
            </h3>
            {equipment.maintenance_note && (
              <p className="text-sm whitespace-pre-line">
                {equipment.maintenance_note}
              </p>
            )}
            {(equipment.maintenance_reported_by || reportedOn) && (
              <p className="text-muted-foreground text-xs">
                Flagged
                {equipment.maintenance_reported_by &&
                  ` by ${equipment.maintenance_reported_by}`}
                {reportedOn && ` · ${reportedOn}`}
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              Parts can still be assigned to it.
            </p>
            <div className="mt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => clear.mutate()}
                disabled={clear.isPending}
              >
                {clear.isPending && <Loader2 className="animate-spin" />}
                Clear flag
              </Button>
            </div>
          </div>
        )}

        {reporting && !flagged && (
          <form
            className="bg-muted flex flex-col gap-2 rounded-lg px-3.5 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (note.trim()) flag.mutate();
            }}
          >
            <Label htmlFor="maintenance-note">What needs fixing?</Label>
            <Textarea
              id="maintenance-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Spindle grinds above 2000 RPM"
              rows={3}
              maxLength={1000}
              autoFocus
              className="bg-card"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={!note.trim() || flag.isPending}
              >
                {flag.isPending && <Loader2 className="animate-spin" />}
                Flag for maintenance
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setReporting(false);
                  setNote("");
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        <section aria-labelledby="assigned-parts-heading">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h3 id="assigned-parts-heading" className="text-base">
              Assigned parts
            </h3>
            <span className="brand-figures text-[13px]">
              {assignedCards.length}
            </span>
          </div>
          {assignedCards.length === 0 ? (
            <p className="text-muted-foreground border-t py-2 text-sm">
              No parts assigned. Assign a part to this equipment from its card
              on the Kanban board.
            </p>
          ) : (
            <ul>
              {assignedCards.map((card) => (
                <AssignedPart
                  key={card.id}
                  card={card}
                  columnTitle={columnTitles.get(card.column_id)}
                />
              ))}
            </ul>
          )}
        </section>

        {equipment.documentation_url && (
          <section className="border-t pt-4">
            <h3 className="mb-1 text-base">Reference</h3>
            <a
              href={equipment.documentation_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm"
            >
              Manual or docs
              <ExternalLink className="size-3.5" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </section>
        )}

        <div className="flex flex-wrap gap-2 border-t pt-4">
          {!flagged && !reporting && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setReporting(true)}
            >
              Flag for maintenance
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onEdit}>
            Edit
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onDelete}
            className="text-[var(--emphasis)]"
          >
            Delete
          </Button>
        </div>
      </div>

      <EquipmentImageLightbox
        images={images}
        initialIndex={lightboxIndex ?? 0}
        open={lightboxIndex !== null}
        onClose={() => setLightboxIndex(null)}
      />
    </>
  );
}
