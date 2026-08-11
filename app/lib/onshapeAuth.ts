/**
 * Onshape Authentication Utilities
 * Simple cookie-based authentication without session abstraction
 *
 * NOTE: This file contains server-only functions that read and write the
 * ambient request/response for the in-flight request. Client components should
 * use API routes to access token functionality.
 *
 * The getters/setters stay `async` even though the underlying helpers are
 * synchronous: they were async under `next/headers`, and every call site awaits
 * them.
 */

import {
  deleteCookie,
  getCookie,
  setCookie,
} from "@tanstack/react-start/server";
import "@tanstack/react-start/server-only";
// Re-exported below so existing `~/lib/onshapeAuth` imports keep working.
export {
  getOAuthStateFromRequest,
  getOnshapeTokensFromRequest,
  isOnshapeAuthenticatedFromRequest,
} from "~/lib/onshapeAuthRequest";
import {
  ONSHAPE_COOKIE_NAMES,
  hasUsableSession,
} from "~/lib/onshapeAuthRequest";
import {
  cookieSameSite,
  cookieSameSiteHeader,
  cookieSecure,
} from "~/lib/cookieOptions";

// Names live with the parser in `onshapeAuthRequest.ts`; this half reads the
// same jar through the ambient request, so it must not keep its own copy.
const COOKIE_NAMES = ONSHAPE_COOKIE_NAMES;

const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const OAUTH_STATE_MAX_AGE = 60 * 10; // 10 minutes for OAuth state

function getCookieOptions() {
  return {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: cookieSameSite(),
    path: "/",
    maxAge: MAX_AGE,
  };
}

function getOAuthStateCookieOptions() {
  return {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: cookieSameSite(),
    path: "/",
    maxAge: OAUTH_STATE_MAX_AGE,
  };
}

/**
 * Get Onshape tokens from cookies
 */
export async function getOnshapeTokens(): Promise<{
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
}> {
  const accessToken = getCookie(COOKIE_NAMES.ACCESS_TOKEN) || null;
  const refreshToken = getCookie(COOKIE_NAMES.REFRESH_TOKEN) || null;
  const expiresAtStr = getCookie(COOKIE_NAMES.EXPIRES_AT);
  const expiresAt = expiresAtStr ? parseInt(expiresAtStr, 10) : null;

  return { accessToken, refreshToken, expiresAt };
}

/**
 * Set Onshape tokens in cookies
 * @server-only - This function modifies cookies and can only be called from Server Actions or Route Handlers
 */
export async function setOnshapeTokens(
  accessToken: string,
  refreshToken: string,
  expiresAt: number
): Promise<void> {
  const options = getCookieOptions();

  setCookie(COOKIE_NAMES.ACCESS_TOKEN, accessToken, options);
  setCookie(COOKIE_NAMES.REFRESH_TOKEN, refreshToken, options);
  setCookie(COOKIE_NAMES.EXPIRES_AT, expiresAt.toString(), options);
}

/**
 * Clear Onshape tokens from cookies
 * @server-only - This function modifies cookies and can only be called from Server Actions or Route Handlers
 */
export async function clearOnshapeTokens(): Promise<void> {
  deleteCookie(COOKIE_NAMES.ACCESS_TOKEN);
  deleteCookie(COOKIE_NAMES.REFRESH_TOKEN);
  deleteCookie(COOKIE_NAMES.EXPIRES_AT);
}

/**
 * Get OAuth state from cookie (for CSRF protection)
 */
export async function getOAuthState(): Promise<string | null> {
  return getCookie(COOKIE_NAMES.OAUTH_STATE) || null;
}

/**
 * Set OAuth state in cookie
 * @server-only - This function modifies cookies and can only be called from Server Actions or Route Handlers
 */
export async function setOAuthState(state: string): Promise<void> {
  setCookie(COOKIE_NAMES.OAUTH_STATE, state, getOAuthStateCookieOptions());
}

/**
 * Clear OAuth state cookie
 * @server-only - This function modifies cookies and can only be called from Server Actions or Route Handlers
 */
export async function clearOAuthState(): Promise<void> {
  deleteCookie(COOKIE_NAMES.OAUTH_STATE);
}

/**
 * Get OAuth redirect destination from cookie
 */
export async function getOAuthRedirect(): Promise<string | null> {
  return getCookie(COOKIE_NAMES.OAUTH_REDIRECT) || null;
}

/**
 * Set OAuth redirect destination in cookie
 * @server-only - This function modifies cookies and can only be called from Server Actions or Route Handlers
 */
export async function setOAuthRedirect(redirect: string): Promise<void> {
  // Same lifetime as the OAuth state cookie.
  setCookie(
    COOKIE_NAMES.OAUTH_REDIRECT,
    redirect,
    getOAuthStateCookieOptions()
  );
}

/**
 * Clear OAuth redirect cookie
 * @server-only - This function modifies cookies and can only be called from Server Actions or Route Handlers
 */
export async function clearOAuthRedirect(): Promise<void> {
  deleteCookie(COOKIE_NAMES.OAUTH_REDIRECT);
}

/**
 * Check if Onshape is authenticated, reading the ambient request's cookies.
 *
 * Shares `hasUsableSession` with the request middleware so the two can never
 * again reach different answers about the same session.
 */
export async function isOnshapeAuthenticated(): Promise<boolean> {
  return hasUsableSession(await getOnshapeTokens());
}

/**
 * Create cookie string for setting tokens (for React Router responses)
 */
export function createTokenCookieString(
  accessToken: string,
  refreshToken: string,
  expiresAt: number
): string {
  const sameSite = cookieSameSiteHeader();
  const secure = cookieSecure() ? "Secure" : "";
  const maxAge = MAX_AGE;

  const accessTokenCookie = `${COOKIE_NAMES.ACCESS_TOKEN}=${accessToken}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=${sameSite}${secure ? `; ${secure}` : ""}`;
  const refreshTokenCookie = `${COOKIE_NAMES.REFRESH_TOKEN}=${refreshToken}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=${sameSite}${secure ? `; ${secure}` : ""}`;
  const expiresAtCookie = `${COOKIE_NAMES.EXPIRES_AT}=${expiresAt}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=${sameSite}${secure ? `; ${secure}` : ""}`;

  return [accessTokenCookie, refreshTokenCookie, expiresAtCookie].join(", ");
}

/**
 * Create cookie string for clearing tokens (for React Router responses)
 */
export function createClearTokenCookieString(): string {
  const clearAccess = `${COOKIE_NAMES.ACCESS_TOKEN}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
  const clearRefresh = `${COOKIE_NAMES.REFRESH_TOKEN}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
  const clearExpires = `${COOKIE_NAMES.EXPIRES_AT}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
  const clearState = `${COOKIE_NAMES.OAUTH_STATE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;

  return [clearAccess, clearRefresh, clearExpires, clearState].join(", ");
}

/**
 * Create cookie string for OAuth state (for React Router responses)
 */
export function createOAuthStateCookieString(state: string): string {
  const sameSite = cookieSameSiteHeader();
  const secure = cookieSecure() ? "Secure" : "";
  const maxAge = OAUTH_STATE_MAX_AGE;

  return `${COOKIE_NAMES.OAUTH_STATE}=${state}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=${sameSite}${secure ? `; ${secure}` : ""}`;
}
