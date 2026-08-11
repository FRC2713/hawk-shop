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
    const { accessToken, expiresAt } = await getOnshapeTokens();

    // If no token, return null
    if (!accessToken) {
      return null;
    }

    // If token is expired, return null (don't try to refresh here)
    if (expiresAt && Date.now() >= expiresAt) {
      return null;
    }

    return accessToken;
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
    // Parse cookies from request
    const cookieHeader = request.headers.get("Cookie");
    if (!cookieHeader) {
      return null;
    }

    const cookies = Object.fromEntries(
      cookieHeader.split("; ").map((c) => {
        const [key, ...values] = c.split("=");
        return [key, decodeURIComponent(values.join("="))];
      })
    );

    const accessToken = cookies.onshape_access_token || null;
    const refreshToken = cookies.onshape_refresh_token || null;
    const expiresAtStr = cookies.onshape_expires_at;
    const expiresAt = expiresAtStr ? parseInt(expiresAtStr, 10) : null;

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
