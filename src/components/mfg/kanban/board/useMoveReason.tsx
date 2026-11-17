import { useEffect, useId, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";

/** Dragging and bulk Move ask once for the reason attached to each returned part. */
export function useMoveReason() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const resolve = useRef<((reason: string | null) => void) | null>(null);
  const id = useId();
  useEffect(() => () => resolve.current?.(null), []);
  const finish = (value: string | null) => {
    resolve.current?.(value);
    resolve.current = null;
    setOpen(false);
  };
  const requestReason = (
    cards: readonly { column_id: string }[],
    target: string
  ): Promise<string | null | undefined> => {
    const { review, backlog, inProgress } = WORKFLOW_COLUMN_IDS;
    if (
      !cards.some((card) => card.column_id === review) ||
      (target !== backlog && target !== inProgress)
    )
      return Promise.resolve(undefined);
    resolve.current?.(null);
    setReason("");
    setOpen(true);
    return new Promise((done) => {
      resolve.current = done;
    });
  };
  const reasonDialog = (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) finish(null);
      }}
    >
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim()) finish(reason.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>Send parts back?</DialogTitle>
            <DialogDescription>
              The reason stays on every returned part for whoever makes it next.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor={id}>Reason</Label>
          <Textarea
            id={id}
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => finish(null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!reason.trim()}>
              Send back
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
  return { requestReason, reasonDialog };
}
