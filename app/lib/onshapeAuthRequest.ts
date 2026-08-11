/**
 * The single definition of "does this carry a usable Onshape session", and the
 * cookie parsing it rests on.
 *
 * These read cookies straight off a `Request` and touch no ambient server
 * state, so — unlike `~/lib/onshapeAuth` — this module carries no `server-only`
 * marker. The global request middleware in `app/start.ts` sits in the client
 * module graph and would fail the build if it pulled in the server-only half.
 *
 * Everything that answers "is this user signed in?" funnels through
 * `hasUsableSession` below: the request middleware, the ambient-cookie helpers
 * in `onshapeAuth.ts`, and the refresh paths in `tokenRefresh.ts`. They each
 * used to carry their own copy of the check and they drifted — a route that
 * tested only for the *presence* of a token disagreed with the two that also
 * checked expiry, and two gates that disagree about the same session is an
 * infinite redirect loop.
 */

export const ONSHAPE_COOKIE_NAMES = {
  ACCESS_TOKEN: "onshape_access_token",
  REFRESH_TOKEN: "onshape_refresh_token",
  EXPIRES_AT: "onshape_expires_at",
  OAUTH_STATE: "onshape_oauth_state",
  OAUTH_REDIRECT: "onshape_oauth_redirect",
} as const;

export type OnshapeSession = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
};

/**
 * Decode one cookie value, falling back to the raw text.
 *
 * `decodeURIComponent` throws `URIError` on a stray `%`, and this runs inside
 * the global request middleware — so a single malformed cookie set by anything
 * else sharing the hostname turned every page into a 500 that the user could
 * only escape by clearing cookies. A value we cannot decode is not worth taking
 * the whole app down for.
 */
function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Tolerant `Cookie:` header parser. Never throws. */
export function parseCookieHeader(
  header: string | null
): Record<string, string> {
  if (!header) return {};

  const cookies: Record<string, string> = {};
  for (const pair of header.split(";")) {
    // `indexOf` rather than `split("=")`: token values are base64 and carry
    // their own "=" padding, which must stay part of the value.
    const separator = pair.indexOf("=");
    if (separator < 1) continue;

    const key = pair.slice(0, separator).trim();
    if (!key) continue;

    cookies[key] = decodeCookieValue(pair.slice(separator + 1).trim());
  }
  return cookies;
}

function parseExpiresAt(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sessionFromCookies(
  cookies: Record<string, string>
): OnshapeSession {
  return {
    accessToken: cookies[ONSHAPE_COOKIE_NAMES.ACCESS_TOKEN] || null,
    refreshToken: cookies[ONSHAPE_COOKIE_NAMES.REFRESH_TOKEN] || null,
    expiresAt: parseExpiresAt(cookies[ONSHAPE_COOKIE_NAMES.EXPIRES_AT]),
  };
}

/**
 * The one predicate: a session counts only with a token **and** a known, future
 * expiry.
 *
 * Demanding the expiry is the point. The checks this replaces all read
 * `if (expiresAt && Date.now() >= expiresAt) return false`, so a *missing*
 * `onshape_expires_at` skipped the comparison entirely and fell through to
 * "valid" — anyone could hand-set `onshape_access_token=anything`, omit the
 * expiry, and walk straight through the gate.
 */
export function hasUsableSession(session: OnshapeSession): boolean {
  if (!session.accessToken) return false;
  if (session.expiresAt === null) return false;
  return Date.now() < session.expiresAt;
}

export function getOnshapeTokensFromRequest(request: Request): OnshapeSession {
  return sessionFromCookies(parseCookieHeader(request.headers.get("Cookie")));
}

export function getOAuthStateFromRequest(request: Request): string | null {
  const cookies = parseCookieHeader(request.headers.get("Cookie"));
  return cookies[ONSHAPE_COOKIE_NAMES.OAUTH_STATE] || null;
}

export function isOnshapeAuthenticatedFromRequest(request: Request): boolean {
  return hasUsableSession(getOnshapeTokensFromRequest(request));
}
