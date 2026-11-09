import { apiFetch } from "./client";

export type ReportContext = {
  page_path?: string;
  card_id?: string;
  error_id?: string;
  error_message?: string;
  user_agent?: string;
  viewport?: string;
};
export const submitProblemReport = (message: string, context: ReportContext) =>
  apiFetch<{ report_id: string }>("/api/reports", {
    method: "POST",
    json: { message, context },
  });

export function currentReportContext(): ReportContext {
  const selected = document.querySelector<HTMLElement>(
    '[data-report-card-id][data-state="open"]'
  );
  return {
    card_id:
      selected?.dataset.reportCardId ||
      new URLSearchParams(window.location.search).get("cardId") ||
      undefined,
    page_path: window.location.pathname,
  };
}

// Shared across React roots. The header owns the dialog on every signed-in page.
export function openProblemReport(context: ReportContext = {}, message = "") {
  window.dispatchEvent(
    new CustomEvent("hawk-shop:report", {
      detail: { context: { ...currentReportContext(), ...context }, message },
    })
  );
}
