/**
 * Client-safe wrapper for the generated Onshape API client
 * This file contains only client-safe exports that can be used in client components
 * It does NOT import any server-only code (tokenRefresh, onshapeAuth, etc.)
 */

import { client as generatedClient } from "./generated/client.gen";
import type { Client, Config } from "./generated/client/types.gen";
import type { Auth } from "./generated/core/auth.gen";

/**
 * Get the base generated client (requires manual token management)
 * Useful for client-side code where you manage tokens yourself
 * This function is client-safe and does not use server-only APIs
 */
export function getOnshapeApiClient(accessToken: string): Client {
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
 * Re-export all SDK functions and types for convenience
 */
export * from "./generated/sdk.gen";
export * from "./generated/types.gen";
export { generatedClient };
