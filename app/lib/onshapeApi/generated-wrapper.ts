/**
 * Server-only wrapper for the generated Onshape API client
 * This integrates the generated client with our existing authentication system
 *
 * NOTE: This file contains server-only functions that use tokenRefresh/onshapeAuth.
 * For client-side usage, use generated-wrapper-client.ts instead.
 */

import {
  getValidOnshapeToken,
  getValidOnshapeTokenFromRequest,
} from "../tokenRefresh";
import { client as generatedClient } from "./generated/client.gen";
import type { Client, Config } from "./generated/client/types.gen";
import type { Auth } from "./generated/core/auth.gen";

/**
 * Create a configured Onshape API client for use in server-side code (Next.js)
 * This automatically handles token refresh and authentication
 *
 * NOTE: This function will attempt to refresh tokens, so it should only be called
 * from Route Handlers or Server Actions where cookies can be modified.
 * For server components, use createOnshapeApiClientReadOnly() instead.
 */
export async function createOnshapeApiClient(): Promise<Client> {
  const accessToken = await getValidOnshapeToken();

  if (!accessToken) {
    throw new Error("Not authenticated with Onshape");
  }

  // Configure the client with bearer token authentication
  // The auth callback will be called for each security requirement
  const config: Config = {
    auth: async (auth: Auth) => {
      // For bearer token auth, return the token (will be prefixed with "Bearer " by the client)
      if (auth.scheme === "bearer" && auth.type === "http") {
        return accessToken;
      }
      // For basic auth, you could return credentials here if needed
      // For now, we'll let bearer auth handle it
      return undefined;
    },
  };

  generatedClient.setConfig(config);
  return generatedClient;
}

/**
 * Create a configured Onshape API client for server components (read-only)
 * This does NOT attempt to refresh tokens, so it's safe to use during server component rendering
 * If the token is expired, it will throw an error that should be handled by the client
 */
export async function createOnshapeApiClientReadOnly(): Promise<Client> {
  const { getOnshapeTokenWithoutRefresh } = await import("../tokenRefresh");
  const accessToken = await getOnshapeTokenWithoutRefresh();

  if (!accessToken) {
    throw new Error("Not authenticated with Onshape");
  }

  // Configure the client with bearer token authentication
  const config: Config = {
    auth: async (auth: Auth) => {
      if (auth.scheme === "bearer" && auth.type === "http") {
        return accessToken;
      }
      return undefined;
    },
  };

  generatedClient.setConfig(config);
  return generatedClient;
}

/**
 * Create a configured Onshape API client from a request (for compatibility)
 * This automatically handles token refresh and authentication
 */
export async function createOnshapeApiClientFromRequest(
  request: Request
): Promise<Client> {
  const accessToken = await getValidOnshapeTokenFromRequest(request);

  if (!accessToken) {
    throw new Error("Not authenticated with Onshape");
  }

  // Configure the client with bearer token authentication
  // The auth callback will be called for each security requirement
  const config: Config = {
    auth: async (auth: Auth) => {
      // For bearer token auth, return the token (will be prefixed with "Bearer " by the client)
      if (auth.scheme === "bearer" && auth.type === "http") {
        return accessToken;
      }
      // For basic auth, you could return credentials here if needed
      // For now, we'll let bearer auth handle it
      return undefined;
    },
  };

  generatedClient.setConfig(config);
  return generatedClient;
}

/**
 * Re-export all SDK functions and types for convenience
 * Note: For client-side usage, import from generated-wrapper-client.ts instead
 */
export * from "./generated/sdk.gen";
export * from "./generated/types.gen";
export { generatedClient };
