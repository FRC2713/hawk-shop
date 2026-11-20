import "virtual:hawk-shop/server-only";
import {
  issuer,
  mcpResource,
  parseScope,
  type OAuthScope,
} from "./settings.js";
import { redirectLabel, redirectMatches } from "./redirect-uris.js";
import {
  approvePending,
  findClient,
  insertPending,
  takePending,
} from "./store.js";

// The authorization endpoint's logic. The consent page and its actions call
// these; the gateway has already signed the person in.

export type AuthorizeView =
  | { kind: "error"; status: number; message: string }
  | { kind: "redirect"; location: string }
  | {
      kind: "consent";
      requestId: string;
      clientName: string;
      redirectLabel: string;
      scope: OAuthScope[];
    };

/** Sends the result back to the client, with RFC 9207's iss parameter. */
function back(redirectUri: string, values: Record<string, string | null>) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(values))
    if (value !== null) url.searchParams.set(key, value);
  url.searchParams.set("iss", issuer());
  return url.href;
}

export function startAuthorization(
  params: URLSearchParams,
  subject: string,
  now = Date.now()
): AuthorizeView {
  const stop = (message: string): AuthorizeView => ({
    kind: "error",
    status: 400,
    message,
  });
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length)
    return stop(
      "This sign-in link repeats a parameter. Start again from the app."
    );
  // Until the client and redirect URI check out, never redirect anywhere.
  const client = findClient(params.get("client_id") ?? "");
  if (!client)
    return stop(
      "Hawk Shop doesn't recognize this app. Remove the connection in the app and add it again."
    );
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!redirectMatches(client.redirectUris, redirectUri))
    return stop("This app asked to return to an address it didn't register.");

  const state = params.get("state");
  const fail = (error: string, description: string): AuthorizeView => ({
    kind: "redirect",
    location: back(redirectUri, {
      error,
      error_description: description,
      state,
    }),
  });
  if (state !== null && state.length > 1024)
    return fail("invalid_request", "state is too long.");
  if (params.get("response_type") !== "code")
    return fail("unsupported_response_type", "Use response_type=code.");
  if (params.get("code_challenge_method") !== "S256")
    return fail("invalid_request", "PKCE with S256 is required.");
  const codeChallenge = params.get("code_challenge") ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge))
    return fail("invalid_request", "code_challenge must be an S256 value.");
  const resource = params.get("resource");
  if (resource !== null && resource !== mcpResource())
    return fail("invalid_target", `Request access to ${mcpResource()}.`);
  const scope = parseScope(params.get("scope"));
  if (!scope)
    return fail(
      "invalid_scope",
      "Members can grant only shop:read and shop:manage."
    );

  const requestId = insertPending(
    {
      clientId: client.clientId,
      subject,
      redirectUri,
      codeChallenge,
      scope,
      state,
    },
    now
  );
  return {
    kind: "consent",
    requestId,
    clientName: client.clientName,
    redirectLabel: redirectLabel(redirectUri),
    scope,
  };
}

/** Approve or deny a pending request. Undefined when it expired or belongs
 * to someone else. */
export function finishAuthorization(
  requestId: string,
  subject: string,
  approve: boolean,
  now = Date.now()
): string | undefined {
  const pending = takePending(requestId, subject, now);
  if (!pending) return undefined;
  if (!approve)
    return back(pending.redirectUri, {
      error: "access_denied",
      error_description: "The member declined.",
      state: pending.state,
    });
  const code = approvePending(pending, now);
  return back(pending.redirectUri, { code, state: pending.state });
}
