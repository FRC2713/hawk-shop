import "virtual:hawk-shop/server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/** The one Slack-facing route that skips Suite identity. */
export const SLACK_INTERACTIONS_PATH = "/api/slack/interactions";

/** Slack's documented replay window for signed requests. */
const MAX_AGE_SECONDS = 5 * 60;

/**
 * Checks Slack's `v0` request signature over the raw body. Returns false for a
 * missing secret, a stale or malformed timestamp, or any mismatch.
 */
export function isSlackSignature(
  secret: string | undefined,
  timestamp: string | null,
  signature: string | null,
  body: string,
  now = Date.now()
): boolean {
  if (!secret || !timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_AGE_SECONDS) return false;
  const expected = Buffer.from(
    "v0=" +
      createHmac("sha256", secret)
        .update(`v0:${timestamp}:${body}`)
        .digest("hex")
  );
  const provided = Buffer.from(signature);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}
