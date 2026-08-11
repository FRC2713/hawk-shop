/**
 * Token Refresh Middleware
 * Provides utilities for automatically refreshing tokens before expiration
 */

import { refreshAccessToken as refreshOnshapeToken } from "./onshapeApi/auth";
import {
  clearOnshapeTokens,
  getOnshapeTokens,
  setOnshapeTokens,
} from "./onshapeAuth";
import {
  getOnshapeTokensFromRequest,
  hasUsableSession,
} from "./onshapeAuthRequest";

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before expiration

/**
 * Check if a token needs to be refreshed (within 5 minutes of expiration)
 */
export function needsRefresh(expiresAt: number | null): boolean {
  if (!expiresAt) return true;
  const now = Date.now();
  const expirationTime = expiresAt - REFRESH_BUFFER_MS;
  return now >= expirationTime;
}

/**
 * Get Onshape token without refreshing (read-only, for server components)
 * This should be used during server component rendering where cookies cannot be modified
 */
export async function getOnshapeTokenWithoutRefresh(): Promise<string | null> {
  try {
    const session = await getOnshapeTokens();
    // Same predicate as the middleware and the auth gate — see
    // `hasUsableSession`. Notably a token with no recorded expiry does not
    // count, here or anywhere else.
    return hasUsableSession(session) ? session.accessToken : null;
  } catch (error) {
    console.error("[TOKEN] Error getting token:", error);
    return null;
  }
}

/**
 * Refresh Onshape token if needed (for route handlers and server actions only)
 * This function can modify cookies, so it should only be called from contexts where that's allowed
 */
export async function refreshOnshapeTokenIfNeeded(): Promise<string | null> {
  try {
    const { accessToken, refreshToken, expiresAt } = await getOnshapeTokens();

    if (!accessToken || !refreshToken) {
      return null;
    }

    // Check if token needs refresh
    if (!needsRefresh(expiresAt)) {
      return accessToken;
    }

    // Refresh token
    const clientId = process.env.ONSHAPE_CLIENT_ID;
    const clientSecret = process.env.ONSHAPE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error("Missing Onshape OAuth credentials");
    }

    try {
      const tokenResponse = await refreshOnshapeToken(
        refreshToken,
        clientId,
        clientSecret
      );

      const newExpiresAt = Date.now() + tokenResponse.expires_in * 1000;

      // Update cookies (only works in Route Handlers or Server Actions)
      await setOnshapeTokens(
        tokenResponse.access_token,
        tokenResponse.refresh_token,
        newExpiresAt
      );

      return tokenResponse.access_token;
    } catch (error) {
      console.error("Failed to refresh Onshape token:", error);
      // Clear invalid tokens
      await clearOnshapeTokens();
      return null; // Return null instead of throwing
    }
  } catch (error) {
    console.error("[TOKEN REFRESH] Error refreshing token:", error);
    return null;
  }
}

/**
 * Refresh Onshape token if needed (accepts request - for compatibility)
 * Note: This function reads cookies from the request headers
 */
export async function refreshOnshapeTokenIfNeededFromRequest(
  request: Request
): Promise<string | null> {
  try {
    // Shared parser: it tolerates a cookie value that will not URL-decode,
    // which a hand-rolled `decodeURIComponent` here used to throw on.
    const { accessToken, refreshToken, expiresAt } =
      getOnshapeTokensFromRequest(request);

    if (!accessToken || !refreshToken) {
      return null;
    }

    // Check if token needs refresh
    if (!needsRefresh(expiresAt)) {
      return accessToken;
    }

    // Refresh token
    const clientId = process.env.ONSHAPE_CLIENT_ID;
    const clientSecret = process.env.ONSHAPE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error("Missing Onshape OAuth credentials");
    }

    try {
      const tokenResponse = await refreshOnshapeToken(
        refreshToken,
        clientId,
        clientSecret
      );

      const newExpiresAt = Date.now() + tokenResponse.expires_in * 1000;

      // Update cookies (this will work in route handlers)
      await setOnshapeTokens(
        tokenResponse.access_token,
        tokenResponse.refresh_token,
        newExpiresAt
      );

      return tokenResponse.access_token;
    } catch (error) {
      console.error("Failed to refresh Onshape token:", error);
      // Clear invalid tokens
      await clearOnshapeTokens();
      return null;
    }
  } catch (error) {
    console.error("[TOKEN REFRESH] Error refreshing token:", error);
    return null;
  }
}

/**
 * Get valid Onshape token, refreshing if necessary (for server components and route handlers)
 */
export async function getValidOnshapeToken(): Promise<string | null> {
  return refreshOnshapeTokenIfNeeded();
}

/**
 * Get valid Onshape token, refreshing if necessary (for request-based usage - compatibility)
 */
export async function getValidOnshapeTokenFromRequest(
  request: Request
): Promise<string | null> {
  return refreshOnshapeTokenIfNeededFromRequest(request);
}
