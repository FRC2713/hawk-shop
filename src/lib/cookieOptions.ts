/**
 * Cookie policy for the Onshape auth cookies.
 *
 * Two deployments need different answers here:
 *
 * - Embedded in Onshape's iframe, the cookies are third-party, so they must be
 *   `SameSite=None; Secure` — which browsers only accept over HTTPS.
 * - Self-hosted on a shop LAN over plain HTTP, `SameSite=None` is rejected
 *   outright and sign-in fails, so `Lax` is the only workable setting.
 *
 * ONSHAPE_IFRAME_EMBED picks between them. It defaults to off because the
 * default self-hosted deployment is a container on the local network; turn it on
 * (and terminate TLS) when embedding the app in Onshape.
 */

function envFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

/** True when the app is served over HTTPS, per APP_URL. */
export function isSecureDeployment(): boolean {
  const explicit = process.env.COOKIE_SECURE;
  if (explicit !== undefined && explicit !== "") {
    return envFlag(explicit, false);
  }
  const appUrl = process.env.APP_URL || process.env.ONSHAPE_REDIRECT_URI;
  return appUrl?.startsWith("https://") ?? false;
}

export function isIframeEmbedded(): boolean {
  return envFlag(process.env.ONSHAPE_IFRAME_EMBED, false);
}

export type SameSitePolicy = "none" | "lax" | "strict";

export function cookieSameSite(): SameSitePolicy {
  // SameSite=None is meaningless without Secure, and browsers drop such cookies
  // silently — fall back to Lax rather than fail to authenticate at all.
  return isIframeEmbedded() && isSecureDeployment() ? "none" : "lax";
}

export function cookieSecure(): boolean {
  return isSecureDeployment();
}

/** Header-string form, e.g. "None" / "Lax", for hand-built Set-Cookie values. */
export function cookieSameSiteHeader(): "None" | "Lax" | "Strict" {
  const value = cookieSameSite();
  return (value.charAt(0).toUpperCase() + value.slice(1)) as
    "None" | "Lax" | "Strict";
}
