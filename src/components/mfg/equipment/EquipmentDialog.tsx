import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, Upload, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { ProcessChips } from "~/components/mfg/processes/ProcessChips";
import {
  createEquipment,
  deleteEquipmentImage,
  processesQuery,
  queryKeys,
  updateEquipment,
  uploadEquipmentImages,
  type EquipmentWithProcesses,
} from "~/lib/api";
import { cn } from "~/lib/utils";

const MAX_IMAGES = 10;

interface EquipmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The equipment to edit; omit to add new equipment. */
  equipment?: EquipmentWithProcesses | null;
  allEquipment: EquipmentWithProcesses[];
  onSaved?: (id: string) => void;
}

interface PendingPhoto {
  key: string;
  file: File;
  url: string;
}

interface FormState {
  name: string;
  location: string;
  processIds: string[];
  documentationUrl: string;
  description: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  location: "",
  processIds: [],
  documentationUrl: "",
  description: "",
};

function formFrom(item: EquipmentWithProcesses): FormState {
  return {
    name: item.name,
    location: item.location ?? "",
    processIds: (item.processes ?? []).map((p) => p.id),
    documentationUrl: item.documentation_url ?? "",
    description: item.description ?? "",
  };
}

function imagesFrom(files: Iterable<File | null>): File[] {
  return [...files].filter(
    (file): file is File => !!file && file.type.startsWith("image/")
  );
}

/** Add or edit equipment. Photos can be pasted, dropped or chosen. */
export function EquipmentDialog({
  open,
  onOpenChange,
  equipment,
  allEquipment,
  onSaved,
}: EquipmentDialogProps) {
  const editing = !!equipment;
  const ids = useId();
  const queryClient = useQueryClient();
  const { data: processes = [] } = useQuery(processesQuery());
  const fileInput = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [copyFrom, setCopyFrom] = useState("");
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [removedImages, setRemovedImages] = useState<string[]>([]);
  const [addAnother, setAddAnother] = useState(true);
  const [tried, setTried] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [photoNote, setPhotoNote] = useState("");
  const [savedNote, setSavedNote] = useState("");

  const existingImages = (equipment?.image_urls ?? []).filter(
    (url) => !removedImages.includes(url)
  );
  const photoCount = existingImages.length + photos.length;

  const releasePhotos = (list: PendingPhoto[]) =>
    list.forEach((photo) => URL.revokeObjectURL(photo.url));

  // Start fresh each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setForm(equipment ? formFrom(equipment) : EMPTY_FORM);
    setCopyFrom("");
    setRemovedImages([]);
    setTried(false);
    setPhotoNote("");
    setSavedNote("");
    setPhotos((previous) => {
      releasePhotos(previous);
      return [];
    });
    // Only a newly opened dialog or another item resets the form; a refetch of
    // the same item while editing must not wipe what was typed.
  }, [open, equipment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => releasePhotos(photos), []); // eslint-disable-line react-hooks/exhaustive-deps

  const locations = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of allEquipment) {
      const location = item.location?.trim();
      if (location && !seen.has(location.toLowerCase()))
        seen.set(location.toLowerCase(), location);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [allEquipment]);

  const copySources = useMemo(
    () =>
      [...allEquipment].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
      ),
    [allEquipment]
  );

  const nameMissing = !form.name.trim();
  const urlInvalid = (() => {
    const url = form.documentationUrl.trim();
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol !== "http:" && parsed.protocol !== "https:";
    } catch {
      return true;
    }
  })();

  const addPhotos = (files: File[], how: "pasted" | "added") => {
    if (files.length === 0) {
      setPhotoNote("Only images can be added.");
      return;
    }
    const room = MAX_IMAGES - photoCount;
    if (room <= 0) {
      setPhotoNote(`You can add up to ${MAX_IMAGES} photos.`);
      return;
    }
    const accepted = files.slice(0, room).map((file, index) => ({
      key: `${Date.now()}-${index}-${file.name}`,
      file,
      url: URL.createObjectURL(file),
    }));
    setPhotos((previous) => [...previous, ...accepted]);
    const skipped = files.length - accepted.length;
    setPhotoNote(
      `${accepted.length} ${accepted.length === 1 ? "photo" : "photos"} ${how}.` +
        (skipped > 0
          ? ` ${skipped} skipped: ${MAX_IMAGES} photos at most.`
          : "")
    );
  };

  const save = useMutation({
    mutationFn: async () => {
      const input = {
        name: form.name.trim(),
        location: form.location.trim(),
        processIds: form.processIds,
        documentationUrl: form.documentationUrl.trim(),
        description: form.description.trim(),
      };
      const saved = equipment
        ? await updateEquipment(equipment.id, input)
        : await createEquipment(input);
      for (const url of removedImages) {
        await deleteEquipmentImage(saved.id, url);
      }
      await uploadEquipmentImages(
        saved.id,
        photos.map((photo) => photo.file)
      );
      return saved;
    },
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.equipment.all() }),
        // A rename moves assigned cards to the new name.
        editing &&
          queryClient.invalidateQueries({ queryKey: queryKeys.kanban.cards() }),
      ]);
      onSaved?.(saved.id);
      if (!editing && addAnother) {
        releasePhotos(photos);
        setPhotos([]);
        setForm((previous) => ({ ...previous, name: "", description: "" }));
        setTried(false);
        setPhotoNote("");
        setSavedNote(
          `${saved.name} added. Location and processes are kept for the next one.`
        );
        return;
      }
      toast.success(editing ? `${saved.name} saved` : `${saved.name} added`);
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (nameMissing || urlInvalid || save.isPending) return;
    setSavedNote("");
    save.mutate();
  };

  const applyCopy = (id: string) => {
    setCopyFrom(id);
    const source = allEquipment.find((item) => item.id === id);
    if (!source) return;
    setForm((previous) => ({
      ...previous,
      location: source.location ?? "",
      processIds: (source.processes ?? []).map((p) => p.id),
      documentationUrl: source.documentation_url ?? "",
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90dvh] gap-0 overflow-y-auto p-0 sm:max-w-[640px]"
        onPaste={(event) => {
          const files = imagesFrom(
            [...event.clipboardData.items]
              .filter((item) => item.kind === "file")
              .map((item) => item.getAsFile())
          );
          // Text pastes into fields carry on as normal.
          if (files.length === 0) return;
          event.preventDefault();
          addPhotos(files, "pasted");
        }}
      >
        <form onSubmit={submit} noValidate>
          <DialogHeader className="border-b px-6 py-4 text-left">
            <DialogTitle className="font-heading text-xl font-semibold">
              {editing ? `Edit ${equipment!.name}` : "Add equipment"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Name, location, processes and photos for this equipment.
            </DialogDescription>
          </DialogHeader>

          {savedNote && (
            <p
              role="status"
              className="bg-muted mx-6 mt-4 flex items-center gap-2 rounded-lg border border-[var(--color-success-border)] px-3.5 py-2.5 text-sm"
            >
              <Check className="size-4" aria-hidden="true" />
              {savedNote}
            </p>
          )}

          <div className="flex flex-col gap-5 px-6 py-5">
            {!editing && copySources.length > 0 && (
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${ids}-copy`}>Start from</Label>
                <select
                  id={`${ids}-copy`}
                  value={copyFrom}
                  onChange={(event) => applyCopy(event.target.value)}
                  className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-md border px-2 text-sm outline-none focus-visible:ring-[3px]"
                  aria-describedby={`${ids}-copy-hint`}
                >
                  <option value="">Blank</option>
                  {copySources.map((item) => (
                    <option key={item.id} value={item.id}>
                      Copy of {item.name}
                    </option>
                  ))}
                </select>
                <span
                  id={`${ids}-copy-hint`}
                  className="text-muted-foreground text-xs"
                >
                  Copies location, processes and docs. Handy for another
                  printer.
                </span>
              </div>
            )}

            <div className="flex flex-wrap gap-4">
              <div className="flex flex-[1_1_260px] flex-col gap-1">
                <Label htmlFor={`${ids}-name`}>Name</Label>
                <Input
                  id={`${ids}-name`}
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  placeholder="Printer 4"
                  aria-invalid={tried && nameMissing}
                  aria-describedby={
                    tried && nameMissing ? `${ids}-name-error` : undefined
                  }
                  autoFocus
                />
                {tried && nameMissing && (
                  <span
                    id={`${ids}-name-error`}
                    className="text-xs text-[var(--emphasis)]"
                  >
                    Enter a name.
                  </span>
                )}
                {editing && form.name.trim() !== equipment!.name && (
                  <span className="text-muted-foreground text-xs">
                    Renaming also updates the machine on its assigned cards.
                  </span>
                )}
              </div>
              <div className="flex flex-[1_1_220px] flex-col gap-1">
                <Label htmlFor={`${ids}-location`}>Location</Label>
                <Input
                  id={`${ids}-location`}
                  value={form.location}
                  onChange={(event) =>
                    setForm({ ...form, location: event.target.value })
                  }
                  placeholder="Print farm, shelf B"
                />
              </div>
            </div>
            {locations.length > 0 && (
              <div className="-mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground text-xs">
                  Used before:
                </span>
                {locations.map((location) => (
                  <button
                    key={location}
                    type="button"
                    onClick={() => setForm({ ...form, location })}
                    aria-pressed={form.location.trim() === location}
                    className={cn(
                      "focus-visible:ring-ring/50 rounded-full border px-2.5 py-0.5 text-xs outline-none focus-visible:ring-[3px]",
                      form.location.trim() === location
                        ? "border-foreground bg-foreground text-background"
                        : "bg-card hover:bg-muted"
                    )}
                  >
                    {location}
                  </button>
                ))}
              </div>
            )}

            <fieldset className="flex flex-col gap-2">
              <legend className="font-heading mb-1 text-sm font-semibold">
                Processes
              </legend>
              <span
                id={`${ids}-process-hint`}
                className="text-muted-foreground -mt-1 text-xs"
              >
                Parts released with these processes can be made here.
              </span>
              <ProcessChips
                processes={processes}
                selectedIds={form.processIds}
                onChange={(processIds) => setForm({ ...form, processIds })}
                describedBy={`${ids}-process-hint`}
              />
            </fieldset>

            <div className="flex flex-col gap-1">
              <span className="font-heading text-sm font-semibold">Photos</span>
              <div className="flex flex-wrap gap-2">
                {existingImages.map((url, index) => (
                  <div
                    key={url}
                    className="bg-muted relative size-[88px] overflow-hidden rounded-lg border"
                  >
                    <img src={url} alt="" className="size-full object-cover" />
                    {index === 0 && <CoverBadge />}
                    <RemoveButton
                      label={`Remove photo ${index + 1}`}
                      onClick={() =>
                        setRemovedImages((previous) => [...previous, url])
                      }
                    />
                  </div>
                ))}
                {photos.map((photo, index) => (
                  <div
                    key={photo.key}
                    className="bg-muted relative size-[88px] overflow-hidden rounded-lg border"
                  >
                    <img
                      src={photo.url}
                      alt=""
                      className="size-full object-cover"
                    />
                    {existingImages.length === 0 && index === 0 && (
                      <CoverBadge />
                    )}
                    <RemoveButton
                      label={`Remove photo ${existingImages.length + index + 1}`}
                      onClick={() => {
                        URL.revokeObjectURL(photo.url);
                        setPhotos((previous) =>
                          previous.filter((p) => p.key !== photo.key)
                        );
                      }}
                    />
                  </div>
                ))}
                {photoCount < MAX_IMAGES && (
                  <div
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragging(false);
                      addPhotos(imagesFrom(event.dataTransfer.files), "added");
                    }}
                    className={cn(
                      "flex min-h-[88px] flex-[1_1_260px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-3 text-center",
                      dragging
                        ? "bg-card border-[var(--primary)]"
                        : "bg-muted border-[var(--color-hawk-cool-grey)]"
                    )}
                  >
                    <Upload className="size-5" aria-hidden="true" />
                    <button
                      type="button"
                      onClick={() => fileInput.current?.click()}
                      className="text-sm font-semibold underline-offset-2 hover:underline"
                    >
                      Paste, drop or choose photos
                    </button>
                    <span className="text-muted-foreground text-xs">
                      Copy an image and press{" "}
                      <kbd className="brand-figures text-xs">Ctrl</kbd>/
                      <kbd className="brand-figures text-xs">⌘</kbd>+
                      <kbd className="brand-figures text-xs">V</kbd> anywhere in
                      this dialog. On a phone, choosing opens the camera.
                    </span>
                    <input
                      ref={fileInput}
                      type="file"
                      accept="image/*"
                      multiple
                      className="sr-only"
                      tabIndex={-1}
                      aria-hidden="true"
                      onChange={(event) => {
                        addPhotos(
                          imagesFrom(event.target.files ?? []),
                          "added"
                        );
                        event.target.value = "";
                      }}
                    />
                  </div>
                )}
              </div>
              {photoNote && (
                <span role="status" className="text-muted-foreground text-xs">
                  {photoNote}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-docs`}>
                Manual or docs link{" "}
                <span className="text-muted-foreground font-sans text-xs font-normal">
                  optional
                </span>
              </Label>
              <Input
                id={`${ids}-docs`}
                type="url"
                value={form.documentationUrl}
                onChange={(event) =>
                  setForm({ ...form, documentationUrl: event.target.value })
                }
                placeholder="https://"
                aria-invalid={tried && urlInvalid}
                aria-describedby={
                  tried && urlInvalid ? `${ids}-docs-error` : undefined
                }
              />
              {tried && urlInvalid && (
                <span
                  id={`${ids}-docs-error`}
                  className="text-xs text-[var(--emphasis)]"
                >
                  Enter a full link starting with https://
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-notes`}>
                Notes{" "}
                <span className="text-muted-foreground font-sans text-xs font-normal">
                  optional
                </span>
              </Label>
              <Textarea
                id={`${ids}-notes`}
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                placeholder="Bed size, materials, quirks"
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="bg-muted flex-row flex-wrap items-center justify-between gap-3 border-t px-6 py-4 sm:justify-between">
            {!editing ? (
              <div className="flex min-h-9 items-center gap-2">
                <Checkbox
                  id={`${ids}-another`}
                  checked={addAnother}
                  onCheckedChange={(checked) => setAddAnother(checked === true)}
                />
                <Label
                  htmlFor={`${ids}-another`}
                  className="font-sans font-normal"
                >
                  Add another after this
                </Label>
              </div>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={save.isPending}
              >
                {savedNote ? "Done" : "Cancel"}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Loader2 className="animate-spin" />}
                {editing ? "Save" : "Add equipment"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CoverBadge() {
  return (
    <span className="bg-foreground text-background absolute bottom-1 left-1 rounded-full px-1.5 text-[11px] leading-4 font-semibold">
      Cover
    </span>
  );
}

function RemoveButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/75 text-white outline-none focus-visible:ring-[3px] focus-visible:ring-white/70"
    >
      <X className="size-3" aria-hidden="true" />
    </button>
  );
}
