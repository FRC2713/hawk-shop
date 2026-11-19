import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Check, Loader2, Upload } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { ProcessChips } from "~/components/mfg/processes/ProcessChips";
import {
  clearEquipmentMaintenance,
  flagEquipmentMaintenance,
  needsMaintenance,
  reorderEquipmentImages,
  uploadEquipmentPhoto,
  createEquipment,
  deleteEquipmentImage,
  processesQuery,
  queryKeys,
  updateEquipment,
  type EquipmentWithProcesses,
} from "~/lib/api";
import { cn } from "~/lib/utils";

import { resizeEquipmentPhoto } from "~/lib/equipment-photos";

const MAX_IMAGES = 10;

interface EquipmentEditorProps {
  onCancel: () => void;
  defaultAddAnother?: boolean;
  /** The equipment to edit; omit to add new equipment. */
  equipment?: EquipmentWithProcesses | null;
  allEquipment: EquipmentWithProcesses[];
  onSaved?: (id: string) => void;
}

interface PendingPhoto {
  key: string;
  file?: File;
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
export function EquipmentEditor({
  onCancel,
  defaultAddAnother = false,
  equipment,
  allEquipment,
  onSaved,
}: EquipmentEditorProps) {
  const editing = !!equipment;
  const ids = useId();
  const queryClient = useQueryClient();
  const { data: processes = [] } = useQuery(processesQuery());
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [copyFrom, setCopyFrom] = useState("");
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [removedImages, setRemovedImages] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [maintenance, setMaintenance] = useState(
    needsMaintenance(equipment ?? { status: null })
  );
  const [maintenanceNote, setMaintenanceNote] = useState(
    equipment?.maintenance_note ?? ""
  );
  const [maintenanceError, setMaintenanceError] = useState("");
  // Keep successful steps on retry if a later upload fails.
  const savedId = useRef(equipment?.id);
  const uploaded = useRef(new Map<string, string>());
  const deleted = useRef(new Set<string>());
  const previews = useRef(new Set<string>());
  const [addAnother, setAddAnother] = useState(defaultAddAnother);
  const [tried, setTried] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [photoNote, setPhotoNote] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [saveError, setSaveError] = useState("");

  const photoCount = photos.length;
  const releasePhotos = () => {
    previews.current.forEach((url) => URL.revokeObjectURL(url));
    previews.current.clear();
  };

  useEffect(() => {
    setForm(equipment ? formFrom(equipment) : EMPTY_FORM);
    setPhotos((equipment?.image_urls ?? []).map((url) => ({ key: url, url })));
  }, [equipment?.id]);

  useEffect(() => () => releasePhotos(), []);

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

  const addPhotos = async (files: File[], how: "pasted" | "added") => {
    if (processing || save.isPending || maintenanceMutation.isPending) return;
    const room = MAX_IMAGES - photoCount;
    if (!files.length || room <= 0) {
      setPhotoNote(
        files.length
          ? `You can add up to ${MAX_IMAGES} photos.`
          : "Only images can be added."
      );
      return;
    }
    setProcessing(true);
    setPhotoNote("Preparing photos…");
    try {
      const accepted: PendingPhoto[] = [];
      for (const original of files.slice(0, room)) {
        const file = await resizeEquipmentPhoto(original);
        const url = URL.createObjectURL(file);
        previews.current.add(url);
        accepted.push({ key: crypto.randomUUID(), file, url });
      }
      setPhotos((previous) => [...previous, ...accepted]);
      setPhotoNote(
        `${accepted.length} photos ${how}.` +
          (files.length > room
            ? ` ${files.length - room} skipped: ${MAX_IMAGES} photos at most.`
            : "")
      );
    } catch (error) {
      setPhotoNote(
        error instanceof Error
          ? error.message
          : "Could not prepare photos. Try a different image."
      );
    } finally {
      setProcessing(false);
    }
  };

  const movePhoto = (index: number, direction: number) => {
    setPhotos((previous) => {
      const next = [...previous];
      [next[index], next[index + direction]] = [
        next[index + direction],
        next[index],
      ];
      return next;
    });
  };

  const maintenanceMutation = useMutation({
    mutationFn: async (fixed: boolean) => {
      setMaintenanceError("");
      if (fixed) await clearEquipmentMaintenance(equipment!.id);
      else await flagEquipmentMaintenance(equipment!.id, maintenanceNote);
      return !fixed;
    },
    onSuccess: async (flagged) => {
      setMaintenance(flagged);
      if (!flagged) setMaintenanceNote("");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.equipment.all(),
      });
    },
    onError: (error: Error) => setMaintenanceError(error.message),
  });

  const save = useMutation({
    mutationFn: async () => {
      const input = {
        name: form.name.trim(),
        location: form.location.trim(),
        processIds: form.processIds,
        documentationUrl: form.documentationUrl.trim(),
        description: form.description.trim(),
      };
      const saved = savedId.current
        ? await updateEquipment(savedId.current, input)
        : await createEquipment(input);
      savedId.current = saved.id;
      for (const url of removedImages) {
        if (!deleted.current.has(url)) {
          await deleteEquipmentImage(saved.id, url);
          deleted.current.add(url);
        }
      }
      const imageUrls: string[] = [];
      for (const photo of photos) {
        let url = uploaded.current.get(photo.key);
        if (!photo.file) url = photo.url;
        else if (!url) {
          url = await uploadEquipmentPhoto(saved.id, photo.file);
          uploaded.current.set(photo.key, url);
        }
        imageUrls.push(url!);
      }
      await reorderEquipmentImages(saved.id, imageUrls);
      return saved;
    },
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.equipment.all() }),
        // A rename moves assigned cards to the new name.
        editing &&
          queryClient.invalidateQueries({ queryKey: queryKeys.kanban.cards() }),
      ]);
      if (!editing && addAnother) {
        releasePhotos();
        savedId.current = undefined;
        uploaded.current.clear();
        deleted.current.clear();
        setRemovedImages([]);
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
      onSaved?.(saved.id);
    },
    onError: (error: Error) =>
      setSaveError(`Could not save: ${error.message}. Retry to finish saving.`),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (
      nameMissing ||
      urlInvalid ||
      save.isPending ||
      processing ||
      maintenanceMutation.isPending
    )
      return;
    setSavedNote("");
    setSaveError("");
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
    <section
      className="bg-card w-full max-w-3xl rounded-xl border"
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
        <header className="border-b px-6 py-4 text-left">
          <h1 className="font-heading text-xl font-semibold">
            {editing ? `Edit ${equipment!.name}` : "Add equipment"}
          </h1>
          <p className="sr-only">
            Name, location, processes and photos for this equipment.
          </p>
        </header>

        {saveError && (
          <p role="alert" className="mx-6 mt-4 rounded-lg border p-3 text-sm">
            {saveError}
          </p>
        )}
        {savedNote && (
          <p
            role="status"
            className="bg-muted mx-6 mt-4 flex items-center gap-2 rounded-lg border border-[var(--color-success-border)] px-3.5 py-2.5 text-sm"
          >
            <Check className="size-4" aria-hidden="true" />
            {savedNote}
          </p>
        )}

        <fieldset
          disabled={
            save.isPending || processing || maintenanceMutation.isPending
          }
          className="flex min-w-0 flex-col gap-5 px-4 py-5 sm:px-6"
        >
          <section aria-label="Photos" className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => cameraInput.current?.click()}
                className="min-h-11"
              >
                <Camera aria-hidden="true" /> Take photo
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => fileInput.current?.click()}
              >
                <Upload aria-hidden="true" /> Photo library
              </Button>
            </div>
            <input
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              tabIndex={-1}
              aria-label="Camera photo"
              onChange={(event) => {
                void addPhotos(imagesFrom(event.target.files ?? []), "added");
                event.target.value = "";
              }}
            />
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-label="Library photos"
              onChange={(event) => {
                void addPhotos(imagesFrom(event.target.files ?? []), "added");
                event.target.value = "";
              }}
            />
            <p className="text-muted-foreground text-sm">
              The first photo is the thumbnail. Up to 10 photos. You can also
              paste or drop images.
            </p>
            <ol
              aria-label="Equipment photos"
              className="grid grid-cols-2 gap-3 sm:grid-cols-3"
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void addPhotos(imagesFrom(event.dataTransfer.files), "added");
              }}
            >
              {photos.map((photo, index) => (
                <li key={photo.key} className="min-w-0 rounded-lg border p-2">
                  <div className="bg-muted relative aspect-square overflow-hidden rounded-md">
                    <img
                      src={photo.url}
                      alt={`Photo ${index + 1}`}
                      className="size-full object-cover"
                    />
                    {index === 0 && <CoverBadge />}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 flex-1 px-2"
                      aria-label={`Move photo ${index + 1} earlier`}
                      disabled={index === 0}
                      onClick={() => movePhoto(index, -1)}
                    >
                      ←
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 flex-1 px-2"
                      aria-label={`Move photo ${index + 1} later`}
                      disabled={index === photos.length - 1}
                      onClick={() => movePhoto(index, 1)}
                    >
                      →
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 w-full"
                      aria-label={`Remove photo ${index + 1}`}
                      onClick={() => {
                        const stored =
                          uploaded.current.get(photo.key) ??
                          (!photo.file ? photo.url : undefined);
                        if (stored)
                          setRemovedImages((previous) => [...previous, stored]);
                        setPhotos((previous) =>
                          previous.filter((p) => p.key !== photo.key)
                        );
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
              <li
                className={cn(
                  "flex min-h-24 items-center justify-center rounded-lg border border-dashed p-3 text-center text-sm",
                  dragging && "bg-muted"
                )}
              >
                Drop photos here
              </li>
            </ol>
            {photoNote && (
              <p role="status" className="text-sm">
                {photoNote}
              </p>
            )}
          </section>

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
                Copies location, processes and docs. Handy for another printer.
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
                  Assigned cards show the new name.
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
            <Label htmlFor={`${ids}-docs`}>
              SOP link{" "}
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
              placeholder="https://docs.google.com/document/d/…"
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
          {equipment && (
            <section
              aria-label="Maintenance"
              className="bg-card flex flex-col gap-3 rounded-lg border p-4"
            >
              <h2 className="text-lg">Maintenance</h2>
              {maintenance ? (
                <>
                  <p className="font-semibold">Needs maintenance</p>
                  <p className="break-words whitespace-pre-wrap">
                    {maintenanceNote || "No note recorded."}
                  </p>
                  <Button
                    type="button"
                    className="min-h-11 self-start"
                    onClick={() => maintenanceMutation.mutate(true)}
                  >
                    Mark fixed
                  </Button>
                </>
              ) : (
                <>
                  <p>No maintenance reported.</p>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`${ids}-maintenance`}>
                      Maintenance note
                    </Label>
                    <p
                      id={`${ids}-maintenance-hint`}
                      className="text-muted-foreground text-xs"
                    >
                      Describe the problem to flag this machine.
                    </p>
                  </div>
                  <Textarea
                    id={`${ids}-maintenance`}
                    aria-describedby={`${ids}-maintenance-hint`}
                    value={maintenanceNote}
                    maxLength={1000}
                    onChange={(event) => setMaintenanceNote(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 self-start"
                    disabled={!maintenanceNote.trim()}
                    onClick={() => maintenanceMutation.mutate(false)}
                  >
                    Report a problem
                  </Button>
                </>
              )}
              {maintenanceError && <p role="alert">{maintenanceError}</p>}
            </section>
          )}
        </fieldset>

        <footer className="bg-muted flex flex-row flex-wrap items-center justify-between gap-3 rounded-b-xl border-t px-6 py-4 sm:justify-between">
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
              onClick={onCancel}
              disabled={
                save.isPending || processing || maintenanceMutation.isPending
              }
            >
              {savedNote ? "Done" : "Cancel"}
            </Button>
            <Button
              type="submit"
              disabled={
                save.isPending || processing || maintenanceMutation.isPending
              }
            >
              {save.isPending && <Loader2 className="animate-spin" />}
              {editing ? "Save" : "Add equipment"}
            </Button>
          </div>
        </footer>
      </form>
    </section>
  );
}

function CoverBadge() {
  return (
    <span className="bg-foreground text-background absolute bottom-1 left-1 rounded-full px-1.5 text-[11px] leading-4 font-semibold">
      Cover
    </span>
  );
}
