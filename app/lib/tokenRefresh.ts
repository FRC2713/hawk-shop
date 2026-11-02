import "@tanstack/react-start/server-only";
/**
 * Read-only operation credentials and explicit OAuth renewal.
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
function needsRefresh(expiresAt: number | null): boolean {
  if (!expiresAt) return true;
  const now = Date.now();
  const expirationTime = expiresAt - REFRESH_BUFFER_MS;
  return now >= expirationTime;
}

/**
 * Read the initiating request's usable token without rotating credentials.
 */
export async function getOnshapeTokenWithoutRefresh(
  request?: Request
): Promise<string | null> {
  try {
    const session = request
      ? getOnshapeTokensFromRequest(request)
      : await getOnshapeTokens();
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
 * Explicit renewal for the OAuth route. Ordinary operations use read-only token access.
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
