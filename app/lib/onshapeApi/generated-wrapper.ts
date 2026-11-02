import "@tanstack/react-start/server-only";
import { getOnshapeTokenWithoutRefresh } from "../tokenRefresh";
import { client as generatedClient } from "./generated/client.gen";
import { createClient } from "./generated/client";
import type { Client } from "./generated/client/types.gen";

function authenticatedClient(accessToken: string | null): Client {
  if (!accessToken) throw new Error("Not authenticated with Onshape");
  return createClient({
    ...generatedClient.getConfig(),
    auth: (auth) =>
      auth.scheme === "bearer" && auth.type === "http"
        ? accessToken
        : undefined,
  });
}

/** Capture this request's identity once. Ordinary operations never renew cookies. */
export async function createOnshapeApiClient(): Promise<Client> {
  return authenticatedClient(await getOnshapeTokenWithoutRefresh());
}

export async function createOnshapeApiClientFromRequest(
  request: Request
): Promise<Client> {
  return authenticatedClient(await getOnshapeTokenWithoutRefresh(request));
}

export * from "./generated/sdk.gen";
export * from "./generated/types.gen";
