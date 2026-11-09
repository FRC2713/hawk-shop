import { useEffect, useId, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import {
  openProblemReport,
  currentReportContext,
  submitProblemReport,
  type ReportContext,
} from "~/lib/api/reports";

export function ReportProblem() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [context, setContext] = useState<ReportContext>({});
  const [reportId, setReportId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (
        event as CustomEvent<{ context?: ReportContext; message?: string }>
      ).detail;
      setContext(detail?.context ?? {});
      if (detail?.message) setMessage(detail.message.slice(0, 2000));
      setReportId("");
      setError("");
      setOpen(true);
    };
    window.addEventListener("hawk-shop:report", listener);
    return () => window.removeEventListener("hawk-shop:report", listener);
  }, []);
  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            className="account-sign-out w-full text-left"
            onClick={() => {
              setContext(currentReportContext());
              setReportId("");
              setError("");
              setOpen(true);
            }}
          >
            Report a problem
          </button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Report a problem</DialogTitle>
          <DialogDescription>
            Describe what happened. Your page, browser, and signed-in name will
            be included for the mentors.
          </DialogDescription>
          {reportId ? (
            <p role="status">
              Report saved for delivery to Slack. Report ID: {reportId}
            </p>
          ) : (
            <form
              className="space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError("");
                try {
                  const result = await submitProblemReport(message, {
                    ...context,
                    page_path: window.location.pathname,
                    user_agent: navigator.userAgent,
                    viewport: window.innerWidth + "x" + window.innerHeight,
                  });
                  setReportId(result.report_id);
                  setMessage("");
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : "Your report could not be saved. Please try again."
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label htmlFor={inputId} className="block font-semibold">
                What went wrong?
              </label>
              <textarea
                id={inputId}
                className="border-input bg-background min-h-32 w-full rounded-md border p-3"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={2000}
                required
                disabled={busy}
              />
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy || !message.trim()}>
                {busy ? "Saving…" : "Send report"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// Error displays in other islands can use this without sharing a React provider.
export function ReportProblemButton({
  context,
  message = "",
  children = "Report this",
}: {
  context?: ReportContext;
  message?: string;
  children?: React.ReactNode;
}) {
  const [enabled, setEnabled] = useState(false);
  useEffect(
    () => setEnabled(document.body.dataset.reportsEnabled === "true"),
    []
  );
  return enabled ? (
    <Button
      type="button"
      variant="outline"
      onClick={() => openProblemReport(context, message)}
    >
      {children}
    </Button>
  ) : null;
}
