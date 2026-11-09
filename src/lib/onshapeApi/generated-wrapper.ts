import "virtual:hawk-shop/server-only";
import { createClient } from "./generated/client";
import { client as generatedClient } from "./generated/client.gen";
import type { Client } from "./generated/client/types.gen";
import {
  isOnshapeConfigured,
  onshapeOrigin,
  onshapeFetch,
  OnshapeConfigurationError,
} from "./auth";

/** Each operation gets a fresh generated client. Credentials remain server-only. */
export async function createOnshapeApiClient(): Promise<Client> {
  if (!isOnshapeConfigured()) throw new OnshapeConfigurationError();
  const path = new URL(
    generatedClient.getConfig().baseUrl || "https://cad.onshape.com/api/v12"
  ).pathname;
  return createClient({
    ...generatedClient.getConfig(),
    baseUrl: onshapeOrigin() + path,
    auth: undefined,
    fetch: onshapeFetch,
  });
}

export * from "./generated/sdk.gen";
export * from "./generated/types.gen";
