import type { APIRoute } from "astro";
import { invalidateOnshapeCacheForDocument } from "~/lib/onshapeApi/cache";
import {
  isOnshapeWebhookSecret,
  ONSHAPE_DOCUMENT_CHANGE_EVENTS,
  ONSHAPE_WEBHOOK_SECRET_PARAM,
  onshapeWebhookSettings,
} from "~/server/onshape-webhook";

/**
 * Receives Onshape webhook deliveries. The only route reachable without Hawk
 * Suite identity (see `src/middleware.ts`), so it answers with empty bodies
 * and never touches shop data: a change event only clears that document's
 * workspace cache entries.
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

export const POST: APIRoute = async ({ request }) => {
  const settings = onshapeWebhookSettings();
  if (!settings) return notFound();
  const provided = new URL(request.url).searchParams.get(
    ONSHAPE_WEBHOOK_SECRET_PARAM
  );
  if (!isOnshapeWebhookSecret(settings, provided)) return notFound();

  // Acknowledge whatever arrives: a non-200 makes Onshape cancel a new
  // registration or retry. Invalidation is a few SQLite deletes, so it runs
  // inline before answering.
  let delivery: unknown;
  try {
    delivery = await request.json();
  } catch {
    return acknowledged();
  }
  const { event, documentId } = (delivery ?? {}) as Record<string, unknown>;
  if (
    typeof event === "string" &&
    ONSHAPE_DOCUMENT_CHANGE_EVENTS.has(event) &&
    typeof documentId === "string" &&
    documentId
  ) {
    try {
      invalidateOnshapeCacheForDocument(documentId);
    } catch (error) {
      console.error("[ONSHAPE WEBHOOK] invalidation failed:", error);
    }
  }
  return acknowledged();
};
