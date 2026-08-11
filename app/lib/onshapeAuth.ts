/**
 * Onshape Authentication Utilities
 * Simple cookie-based authentication without session abstraction
 *
 * NOTE: This file contains server-only functions that use next/headers.
 * Client components should use API routes to access token functionality.
 */

import { cookies } from "next/headers";
import "server-only";
import {
  cookieSameSite,
  cookieSameSiteHeader,
  cookieSecure,
} from "~/lib/cookieOptions";

const COOKIE_NAMES = {
  ACCESS_TOKEN: "onshape_access_token",
  REFRESH_TOKEN: "onshape_refresh_token",
  EXPIRES_AT: "onshape_expires_at",
  OAUTH_STATE: "onshape_oauth_state",
  OAUTH_REDIRECT: "onshape_oauth_redirect",
} as const;

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
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(COOKIE_NAMES.ACCESS_TOKEN)?.value || null;
  const refreshToken =
    cookieStore.get(COOKIE_NAMES.REFRESH_TOKEN)?.value || null;
  const expiresAtStr = cookieStore.get(COOKIE_NAMES.EXPIRES_AT)?.value;
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
  const cookieStore = await cookies();
  const options = getCookieOptions();

  cookieStore.set(COOKIE_NAMES.ACCESS_TOKEN, accessToken, options);
  cookieStore.set(COOKIE_NAMES.REFRESH_TOKEN, refreshToken, options);
  cookieStore.set(COOKIE_NAMES.EXPIRES_AT, expiresAt.toString(), options);
}

/**
 * Clear Onshape tokens from cookies
 * @server-only - This function modifies cookies and can only be called from Server Actions or Route Handlers
 */
export async function clearOnshapeTokens(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAMES.ACCESS_TOKEN);
  cookieStore.delete(COOKIE_NAMES.REFRESH_TOKEN);
  cookieStore.delete(COOKIE_NAMES.EXPIRES_AT);
}

/**
 * Get OAuth state from cookie (for CSRF protection)
 */
export async function getOAuthState(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAMES.OAUTH_STATE)?.value || null;
}

/**
 * Set OAuth state in cookie
 * @server-only - This function modifies cookies and can only be called from Server Actions or Route Handlers
 */
export async function setOAuthState(state: string): Promise<void> {
  const cookieStore = await cookies();
  const options = getOAuthStateCookieOptions();
  cookieStore.set(COOKIE_NAMES.OAUTH_STATE, state, options);
}

/**
 * Clear OAuth state cookie
 * @server-only - This function modifies cookies and can only be called from Server Actions or Route Handlers
 */
export async function clearOAuthState(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAMES.OAUTH_STATE);
}

/**
 * Get OAuth redirect destination from cookie
 */
export async function getOAuthRedirect(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAMES.OAUTH_REDIRECT)?.value || null;
}

/**
 * Set OAuth redirect destination in cookie
 * @server-only - This function modifies cookies and can only be called from Server Actions or Route Handlers
 */
export async function setOAuthRedirect(redirect: string): Promise<void> {
  const cookieStore = await cookies();
  const options = getOAuthStateCookieOptions(); // Use same options as OAuth state
  cookieStore.set(COOKIE_NAMES.OAUTH_REDIRECT, redirect, options);
}

/**
 * Clear OAuth redirect cookie
 * @server-only - This function modifies cookies and can only be called from Server Actions or Route Handlers
 */
export async function clearOAuthRedirect(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAMES.OAUTH_REDIRECT);
}

/**
 * Check if Onshape is authenticated (has valid access token)
 * Also checks token expiration to match middleware behavior
 */
export async function isOnshapeAuthenticated(): Promise<boolean> {
  const { accessToken, expiresAt } = await getOnshapeTokens();
  if (!accessToken) return false;
  // Check if token is expired
  if (expiresAt && Date.now() >= expiresAt) return false;
  return true;
}

/**
 * Get Onshape access token (does not refresh - use tokenRefresh for that)
 */
export async function getOnshapeToken(): Promise<string | null> {
  const { accessToken } = await getOnshapeTokens();
  return accessToken;
}

/**
 * Parse cookies from request headers
 */
function parseCookiesFromRequest(request: Request): Record<string, string> {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) {
    return {};
  }

  return Object.fromEntries(
    cookieHeader.split("; ").map((c) => {
      const [key, ...values] = c.split("=");
      return [key, decodeURIComponent(values.join("="))];
    })
  );
}

/**
 * Get Onshape tokens from request cookies
 */
export function getOnshapeTokensFromRequest(request: Request): {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
} {
  const cookies = parseCookiesFromRequest(request);
  const accessToken = cookies.onshape_access_token || null;
  const refreshToken = cookies.onshape_refresh_token || null;
  const expiresAtStr = cookies.onshape_expires_at;
  const expiresAt = expiresAtStr ? parseInt(expiresAtStr, 10) : null;

  return { accessToken, refreshToken, expiresAt };
}

/**
 * Get OAuth state from request cookies
 */
export function getOAuthStateFromRequest(request: Request): string | null {
  const cookies = parseCookiesFromRequest(request);
  return cookies.onshape_oauth_state || null;
}

/**
 * Check if Onshape is authenticated from a request (for route handlers)
 * Reads cookies from request headers and validates token expiration
 */
export function isOnshapeAuthenticatedFromRequest(request: Request): boolean {
  const { accessToken, expiresAt } = getOnshapeTokensFromRequest(request);
  if (!accessToken) return false;
  // Check if token is expired
  if (expiresAt && Date.now() >= expiresAt) return false;
  return true;
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
