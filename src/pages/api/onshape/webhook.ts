import type { APIRoute } from "astro";
import { partStudioFreshness } from "~/lib/onshapeApi/partStudioFreshness";
import { onshapeWebhookUpkeep } from "~/lib/onshapeApi/webhooks";
import {
  isOnshapeWebhookSecret,
  ONSHAPE_DOCUMENT_CHANGE_EVENTS,
  ONSHAPE_WEBHOOK_SECRET_PARAM,
  onshapeWebhookSettings,
} from "~/server/onshape-webhook";

/**
 * Receives Onshape webhook deliveries. The only route reachable without Hawk
 * Suite identity (see `src/middleware.ts`), so it answers with empty bodies
 * and never touches shop data: a change event only marks that document's
 * workspace Part Studio reads stale (see `partStudioFreshness.changed`).
 *
 * Disabled, wrong secret and missing secret all look the same: 404.
 */
const notFound = () =>
  new Response(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });

const acknowledged = () =>
  new Response(null, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });

/**
 * The element a delivery names, or undefined to mark the whole document. Onshape's
 * documented example shows a placeholder of zeros, which names no real element.
 */
function changedElement(elementId: unknown): string | undefined {
  if (typeof elementId !== "string") return undefined;
  const trimmed = elementId.trim();
  return trimmed && !/^0+$/.test(trimmed) ? trimmed : undefined;
}

export const POST: APIRoute = async ({ request }) => {
  const settings = onshapeWebhookSettings();
  if (!settings) return notFound();
  const provided = new URL(request.url).searchParams.get(
    ONSHAPE_WEBHOOK_SECRET_PARAM
  );
  if (!isOnshapeWebhookSecret(settings, provided)) return notFound();

  // Acknowledge whatever arrives: a non-200 makes Onshape cancel a new
  // registration or retry. Marking is a few SQLite updates, so it runs inline
  // before answering.
  let delivery: unknown;
  try {
    delivery = await request.json();
  } catch {
    return acknowledged();
  }
  const { event, documentId, elementId } = (delivery ?? {}) as Record<
    string,
    unknown
  >;
  // Any authenticated delivery shows the webhook works, pings included.
  if (typeof documentId === "string" && documentId)
    onshapeWebhookUpkeep.deliverySeen(documentId);
  if (
    typeof event === "string" &&
    ONSHAPE_DOCUMENT_CHANGE_EVENTS.has(event) &&
    typeof documentId === "string" &&
    documentId
  ) {
    try {
      partStudioFreshness.changed(documentId, changedElement(elementId));
    } catch (error) {
      console.error("[ONSHAPE WEBHOOK] marking stale failed:", error);
    }
  }
  return acknowledged();
};
