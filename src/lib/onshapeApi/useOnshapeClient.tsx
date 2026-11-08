import { getOnshapeApiClient } from "./generated-wrapper-client";
import { useEffect, useState } from "react";
import type { Client } from "./generated/client/types.gen";

/**
 * React hook to get an Onshape API client for use in client components
 * Fetches the access token from an API route and creates a client with it
 */
export function useOnshapeClient() {
  const [client, setClient] = useState<Client | undefined>(undefined);

  useEffect(() => {
    // Fetch token from API route (server-side handles cookie access)
    fetch("/api/onshape/token")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Failed to get token");
        }
        const data = await response.json();
        const accessToken = data.accessToken;

        if (!accessToken) {
          throw new Error("No access token returned");
        }

        // Create client with the token
        const clientInstance = getOnshapeApiClient(accessToken);
        setClient(clientInstance);
      })
      .catch((error) => {
        console.error("[useOnshapeClient] Error fetching token:", error);
        // Don't set client on error - it will remain undefined
      });
  }, []);

  return client;
}
