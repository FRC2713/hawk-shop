import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";
import {
  checkPartForRelease,
  type ReleaseCheckContext,
} from "~/onshape_connector/utils/partEligibility";
import { ProjectPicker } from "./ProjectPicker";
import { ReleaseIssues } from "./ReleaseIssues";
import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, nextFriday, nextMonday, parseISO } from "date-fns";
import { Image as ImageIcon, Minus, Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { ProcessChips } from "~/components/mfg/processes/ProcessChips";
import { equipmentQuery, needsMaintenance, processesQuery } from "~/lib/api";
import { cn } from "~/lib/utils";

export interface AddCardFormData {
  processIds: string[];
  projectId: string;
  quantityToMake: number;
  dueDate: Date | undefined;
}

interface AddCardDialogProps {
  part?: BtPartMetadataInfo;
  partNumber?: string;
  thumbnailUrl?: string;
  /** "Version V14", "Main workspace" and so on. */
  sourceLabel?: string;
  matchingCard?: ReleaseCheckContext["matchingCard"];
  instanceType?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: AddCardFormData) => void;
  isSubmitting?: boolean;
}

const MIN_QUANTITY = 1;

function swatch(part?: BtPartMetadataInfo) {
  const color = part?.appearance?.color;
  if (
    color?.red === undefined ||
    color.green === undefined ||
    color.blue === undefined
  )
    return null;
  return `rgb(${color.red} ${color.green} ${color.blue})`;
}

function QuantityStepper({
  id,
  value,
  onChange,
  disabled,
  invalid,
}: {
  id: string;
  value: number | "";
  onChange: (value: number | "") => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const current = value === "" ? MIN_QUANTITY : value;
  const set = (next: number) => onChange(Math.max(MIN_QUANTITY, next));
  return (
    <div className="flex flex-[0_1_auto] flex-col gap-1">
      <label htmlFor={id} className="font-heading text-sm font-semibold">
        Quantity to make
      </label>
      <div className="flex h-9">
        <button
          type="button"
          aria-label="Make one fewer"
          aria-controls={id}
          onClick={() => set(current - 1)}
          disabled={disabled || current <= MIN_QUANTITY}
          className="border-input bg-card hover:bg-muted focus-visible:ring-ring/50 flex w-9 items-center justify-center rounded-l-md border outline-none focus-visible:ring-[3px] disabled:opacity-50"
        >
          <Minus className="size-4" aria-hidden="true" />
        </button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={MIN_QUANTITY}
          step={1}
          required
          value={value}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={`${id}-help`}
          onChange={(event) => {
            if (event.target.value === "") return onChange("");
            const parsed = parseInt(event.target.value, 10);
            if (!Number.isNaN(parsed)) set(parsed);
          }}
          onBlur={() => {
            if (value === "") onChange(MIN_QUANTITY);
          }}
          className="border-input bg-card brand-figures focus-visible:ring-ring/50 w-16 [appearance:textfield] border-y text-center text-sm font-bold outline-none focus-visible:ring-[3px] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          type="button"
          aria-label="Make one more"
          aria-controls={id}
          onClick={() => set(current + 1)}
          disabled={disabled}
          className="border-input bg-card hover:bg-muted focus-visible:ring-ring/50 flex w-9 items-center justify-center rounded-r-md border outline-none focus-visible:ring-[3px] disabled:opacity-50"
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </div>
      <span id={`${id}-help`} className="text-muted-foreground text-xs">
        Total, spares included
      </span>
    </div>
  );
}

export function AddCardDialog({
  part,
  partNumber,
  thumbnailUrl,
  sourceLabel,
  matchingCard,
  instanceType,
  open,
  onOpenChange,
  onSubmit,
  isSubmitting = false,
}: AddCardDialogProps) {
  const ids = useId();
  const [processIds, setProcessIds] = useState<string[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState<number | "">(MIN_QUANTITY);
  const [due, setDue] = useState("");
  const [tried, setTried] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProcessIds([]);
    setProjectId(null);
    setQuantity(MIN_QUANTITY);
    setDue("");
    setTried(false);
  }, [open]);

  const { data: processes = [] } = useQuery(processesQuery());
  const { data: equipment = [] } = useQuery({
    ...equipmentQuery(),
    enabled: open,
  });

  const issues = checkPartForRelease(part, { matchingCard, instanceType });
  const blocked = issues.some((issue) => issue.severity === "error");
  const noProcess = processIds.length === 0;
  const noProject = !projectId;
  const noQuantity = quantity === "";

  const capable = useMemo(
    () =>
      equipment
        .filter((item) =>
          item.processes?.some((process) => processIds.includes(process.id))
        )
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true })
        )
        .map((item) =>
          needsMaintenance(item)
            ? `${item.name} (needs maintenance)`
            : item.name
        ),
    [equipment, processIds]
  );

  const duePresets = useMemo(() => {
    const today = new Date();
    return [nextFriday(today), nextMonday(today)].map((date) => ({
      value: format(date, "yyyy-MM-dd"),
      label: format(date, "EEE, MMM d"),
    }));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const thumbnail =
    thumbnailUrl && !thumbnailFailed
      ? `/api/onshape/thumbnail?url=${encodeURIComponent(thumbnailUrl)}`
      : null;
  const color = swatch(part);
  const title = partNumber || part?.partNumber || part?.name || "This part";
  const subtitle = part?.description || part?.name;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (noProcess || noProject || noQuantity || blocked || isSubmitting) return;
    onSubmit({
      processIds,
      projectId,
      quantityToMake: quantity,
      dueDate: due ? parseISO(due) : undefined,
    });
  };

  const presetClass = (active: boolean) =>
    cn(
      "focus-visible:ring-ring/50 h-8 rounded-full border px-2.5 text-xs outline-none focus-visible:ring-[3px]",
      active
        ? "border-foreground bg-foreground text-background"
        : "bg-card hover:bg-muted"
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] gap-0 overflow-y-auto p-0 sm:max-w-[600px]">
        <form onSubmit={submit} noValidate>
          <DialogHeader className="border-b px-6 py-4 text-left">
            <DialogTitle className="font-heading text-xl font-semibold">
              Release to manufacturing
            </DialogTitle>
            <DialogDescription className="sr-only">
              Creates a card for this part in the first Kanban column.
            </DialogDescription>
          </DialogHeader>

          <div className="bg-muted flex items-center gap-4 border-b px-6 py-4">
            <div className="bg-card flex size-[72px] shrink-0 items-center justify-center overflow-hidden rounded-lg border">
              {thumbnail ? (
                <img
                  src={thumbnail}
                  alt=""
                  className="size-full object-contain"
                  onError={() => setThumbnailFailed(true)}
                />
              ) : (
                <ImageIcon
                  className="text-muted-foreground size-6"
                  aria-hidden="true"
                />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="brand-figures truncate text-base font-bold">
                {title}
              </p>
              {subtitle && subtitle !== title && (
                <p className="truncate font-semibold">{subtitle}</p>
              )}
              {sourceLabel && (
                <p className="text-muted-foreground text-xs">{sourceLabel}</p>
              )}
              <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                <span className="bg-card rounded-full border px-2 leading-5">
                  {part?.material?.displayName || "No material"}
                </span>
                {color && (
                  <span className="bg-card inline-flex items-center gap-1.5 rounded-full border px-2 leading-5">
                    <span
                      className="size-2.5 rounded-full border"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    Appearance
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-5 px-6 py-5">
            <ReleaseIssues issues={issues} />

            <div className="flex flex-wrap items-start gap-4">
              <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1">
                <label
                  htmlFor={`${ids}-project`}
                  className="font-heading text-sm font-semibold"
                >
                  Project
                </label>
                <ProjectPicker
                  id={`${ids}-project`}
                  value={projectId}
                  onChange={setProjectId}
                  disabled={isSubmitting}
                  invalid={tried && noProject}
                  describedBy={
                    tried && noProject ? `${ids}-project-error` : undefined
                  }
                />
                {tried && noProject && (
                  <span
                    id={`${ids}-project-error`}
                    className="text-xs text-[var(--emphasis)]"
                  >
                    Pick a project, or Miscellaneous for a one-off part.
                  </span>
                )}
              </div>
              <QuantityStepper
                id={`${ids}-quantity`}
                value={quantity}
                onChange={setQuantity}
                disabled={isSubmitting}
                invalid={tried && noQuantity}
              />
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="font-heading mb-1 text-sm font-semibold">
                Processes
              </legend>
              <ProcessChips
                processes={processes}
                selectedIds={processIds}
                onChange={setProcessIds}
                disabled={isSubmitting}
                invalid={tried && noProcess}
                describedBy={
                  tried && noProcess ? `${ids}-process-error` : undefined
                }
              />
              {tried && noProcess && (
                <span
                  id={`${ids}-process-error`}
                  className="text-xs text-[var(--emphasis)]"
                >
                  Pick at least one process.
                </span>
              )}
              {capable.length > 0 && (
                <p className="bg-muted rounded-r-lg border-l-4 border-[var(--hawk-teal)] px-3.5 py-2 text-xs">
                  <span className="font-semibold">Can be made on: </span>
                  {capable.join(", ")}
                </p>
              )}
            </fieldset>

            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-due`} className="text-sm font-semibold">
                Due{" "}
                <span className="text-muted-foreground font-sans text-xs font-normal">
                  optional
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id={`${ids}-due`}
                  type="date"
                  value={due}
                  onChange={(event) => setDue(event.target.value)}
                  disabled={isSubmitting}
                  className="border-input bg-card focus-visible:ring-ring/50 h-9 rounded-md border px-2.5 text-sm outline-none focus-visible:ring-[3px]"
                />
                {duePresets.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    aria-pressed={due === preset.value}
                    onClick={() => setDue(preset.value)}
                    className={presetClass(due === preset.value)}
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={due === ""}
                  onClick={() => setDue("")}
                  className={presetClass(due === "")}
                >
                  No date
                </button>
              </div>
            </div>
          </div>

          <DialogFooter className="bg-muted flex-row flex-wrap items-center justify-between gap-3 border-t px-6 py-4 sm:justify-between">
            <span className="text-muted-foreground flex-[1_1_200px] text-xs">
              {blocked
                ? "Fix the error above in Onshape to release."
                : "Creates a card in the first Kanban column. Assign equipment from the card."}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || blocked}>
                {isSubmitting
                  ? "Releasing..."
                  : quantity === ""
                    ? "Release"
                    : `Release ${quantity}`}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
