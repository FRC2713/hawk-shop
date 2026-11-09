import "virtual:hawk-shop/server-only";

/**
 * Configuration for receiving Onshape webhooks (see docs/ONSHAPE.md#webhooks).
 *
 * Webhooks are optional. They are enabled only when both
 * `ONSHAPE_WEBHOOK_SECRET` and `ONSHAPE_WEBHOOK_BASE_URL` are set; otherwise
 * the route answers 404 and nothing should register. A LAN-only install keeps
 * working on TTL expiry alone.
 *
 * Onshape does not sign deliveries, so the secret travels in the registered
 * callback URL's query string. Registration builds that URL with
 * `onshapeWebhookCallbackUrl`; the route checks it with
 * `isOnshapeWebhookSecret`.
 */

import { createHash, timingSafeEqual } from "node:crypto";

/** The one path exempt from Hawk Suite identity, for POST only. */
export const ONSHAPE_WEBHOOK_PATH = "/api/onshape/webhook";

/** Query parameter that carries the shared secret. */
export const ONSHAPE_WEBHOOK_SECRET_PARAM = "secret";

export type OnshapeWebhookSettings = {
  secret: string;
  /** Public origin (and optional path prefix) Onshape can reach. */
  baseUrl: URL;
};

/** The webhook settings, or `null` when webhooks are disabled. */
export function onshapeWebhookSettings(): OnshapeWebhookSettings | null {
  const secret = process.env.ONSHAPE_WEBHOOK_SECRET?.trim();
  const base = process.env.ONSHAPE_WEBHOOK_BASE_URL?.trim();
  if (!secret || !base) return null;
  let baseUrl: URL;
  try {
    baseUrl = new URL(base);
  } catch {
    console.error("[ONSHAPE WEBHOOK] ONSHAPE_WEBHOOK_BASE_URL is not a URL");
    return null;
  }
  if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") {
    console.error("[ONSHAPE WEBHOOK] ONSHAPE_WEBHOOK_BASE_URL must be http(s)");
    return null;
  }
  return { secret, baseUrl };
}

/** The URL to register with Onshape, secret included. */
export function onshapeWebhookCallbackUrl(
  settings: OnshapeWebhookSettings
): string {
  const url = new URL(settings.baseUrl);
  url.pathname = url.pathname.replace(/\/+$/, "") + ONSHAPE_WEBHOOK_PATH;
  url.search = "";
  url.hash = "";
  url.searchParams.set(ONSHAPE_WEBHOOK_SECRET_PARAM, settings.secret);
  return url.toString();
}

/** Constant-time comparison; hashing first hides the secret's length too. */
export function isOnshapeWebhookSecret(
  settings: OnshapeWebhookSettings,
  provided: string | null
): boolean {
  if (provided === null) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(settings.secret));
}

/**
 * Events after which a document's workspace reads may be stale. Anything else
 * (`webhook.register`, `webhook.ping`, …) is acknowledged and ignored.
 */
export const ONSHAPE_DOCUMENT_CHANGE_EVENTS: ReadonlySet<string> = new Set([
  "onshape.model.lifecycle.changed",
  "onshape.model.lifecycle.createversion",
  "onshape.model.lifecycle.metadata",
]);
