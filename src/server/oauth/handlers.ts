import "virtual:hawk-shop/server-only";
import { z } from "zod";
import { ApiError, errorResponse, json } from "./http";
import { parseJson, readBody } from "./http";
import {
  issuer,
  mcpResource,
  oauthScopes,
  parseScope,
  requireOAuth,
} from "./settings.js";
import { validRedirectUri } from "./redirect-uris.js";
import {
  exchangeCode,
  findClient,
  insertClient,
  refreshTokens,
  revokeToken,
  sweep,
  takeRateToken,
} from "./store.js";

// Public OAuth endpoints for MCP clients. Hawk Suite's gateway passes these
// through without a session, so each one stands on its own checks.

class OAuthError extends Error {
  constructor(
    public status: number,
    public error: string,
    description: string,
    public headers: Record<string, string> = {}
  ) {
    super(description);
  }
}

function respond(error: unknown): Response {
  if (error instanceof OAuthError)
    return json(
      { error: error.error, error_description: error.message },
      error.status,
      { pragma: "no-cache", ...error.headers }
    );
  return errorResponse(error);
}

const metadataHeaders = { "cache-control": "public, max-age=300" };

/** RFC 9728. Served at the root and at the /mcp-suffixed path. */
export function protectedResourceMetadata(): Response {
  try {
    requireOAuth();
    return json(
      {
        resource: mcpResource(),
        authorization_servers: [issuer()],
        scopes_supported: oauthScopes,
        bearer_methods_supported: ["header"],
        resource_name: "Hawk Shop",
      },
      200,
      metadataHeaders
    );
  } catch (error) {
    return respond(error);
  }
}

/** RFC 8414. */
export function authorizationServerMetadata(): Response {
  try {
    requireOAuth();
    const base = issuer();
    return json(
      {
        issuer: base,
        authorization_endpoint: `${base}/oauth/authorize`,
        token_endpoint: `${base}/oauth/token`,
        registration_endpoint: `${base}/oauth/register`,
        revocation_endpoint: `${base}/oauth/revoke`,
        scopes_supported: oauthScopes,
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        revocation_endpoint_auth_methods_supported: ["none"],
        authorization_response_iss_parameter_supported: true,
      },
      200,
      metadataHeaders
    );
  } catch (error) {
    return respond(error);
  }
}

/** Behind Caddy, X-Forwarded-For holds only the peer Caddy saw. */
const clientIp = (request: Request) =>
  request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "direct";

function limit(
  request: Request,
  kind: string,
  capacity: number,
  refillMs: number,
  now: number
) {
  if (!takeRateToken(`${kind}:${clientIp(request)}`, capacity, refillMs, now))
    throw new OAuthError(
      429,
      "temporarily_unavailable",
      "Too many requests. Wait a minute and try again.",
      { "retry-after": "60" }
    );
}

const registration = z.looseObject({
  redirect_uris: z.array(z.string()).min(1).max(5),
  client_name: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

/** RFC 7591 dynamic registration, public clients only. */
export async function register(
  request: Request,
  now = Date.now()
): Promise<Response> {
  try {
    requireOAuth();
    if (
      !/^application\/json(?:\s*;.*)?$/i.test(
        request.headers.get("content-type") ?? ""
      )
    )
      throw new OAuthError(
        415,
        "invalid_client_metadata",
        "Use application/json"
      );
    limit(request, "register", 10, 6 * 60_000, now);
    sweep(now);
    const parsed = registration.safeParse(parseJson(await readBody(request)));
    if (!parsed.success)
      throw new OAuthError(
        400,
        "invalid_client_metadata",
        "Send redirect_uris as an array of one to five URLs."
      );
    const body = parsed.data;
    if (!body.redirect_uris.every(validRedirectUri))
      throw new OAuthError(
        400,
        "invalid_redirect_uri",
        "Redirect URIs must use HTTPS, or HTTP on a loopback address, with no fragment."
      );
    if (
      body.grant_types?.some(
        (g) => g !== "authorization_code" && g !== "refresh_token"
      ) ||
      body.response_types?.some((r) => r !== "code")
    )
      throw new OAuthError(
        400,
        "invalid_client_metadata",
        "Only the authorization_code and refresh_token grants are supported."
      );
    const name =
      body.client_name?.replace(/\s+/g, " ").trim().slice(0, 100) ||
      "Unnamed app";
    const client = insertClient(name, [...new Set(body.redirect_uris)], now);
    return json(
      {
        client_id: client.clientId,
        client_id_issued_at: Math.floor(now / 1000),
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: oauthScopes.join(" "),
      },
      201,
      { pragma: "no-cache" }
    );
  } catch (error) {
    if (error instanceof ApiError && error.status !== 404)
      return respond(
        new OAuthError(400, "invalid_client_metadata", error.message)
      );
    return respond(error);
  }
}

const MAX_FORM = 16_384;

/** RFC 6749 form bodies. Repeated parameters are refused. */
async function readForm(request: Request): Promise<URLSearchParams> {
  const invalid = (message: string) =>
    new OAuthError(400, "invalid_request", message);
  if (
    !/^application\/x-www-form-urlencoded\s*(;.*)?$/i.test(
      request.headers.get("content-type") ?? ""
    )
  )
    throw invalid("Use application/x-www-form-urlencoded.");
  if (Number(request.headers.get("content-length")) > MAX_FORM)
    throw invalid("The request body is too large.");
  const text = (await readBody(request, MAX_FORM)).toString("utf8");
  if (text.length > MAX_FORM) throw invalid("The request body is too large.");
  const form = new URLSearchParams(text);
  const keys = [...form.keys()];
  if (new Set(keys).size !== keys.length)
    throw invalid("Send each parameter once.");
  return form;
}

function publicClient(form: URLSearchParams) {
  const clientId = form.get("client_id");
  if (!clientId)
    throw new OAuthError(400, "invalid_request", "client_id is required.");
  const client = findClient(clientId);
  if (!client)
    throw new OAuthError(401, "invalid_client", "Register this client again.");
  return client;
}

function required(form: URLSearchParams, name: string): string {
  const value = form.get(name);
  if (!value || value.length > 2048)
    throw new OAuthError(400, "invalid_request", `${name} is required.`);
  return value;
}

export async function token(
  request: Request,
  now = Date.now()
): Promise<Response> {
  try {
    requireOAuth();
    const form = await readForm(request);
    limit(request, "token", 60, 1000, now);
    const client = publicClient(form);
    const resource = form.get("resource");
    if (resource !== null && resource !== mcpResource())
      throw new OAuthError(
        400,
        "invalid_target",
        `This server issues tokens only for ${mcpResource()}.`
      );
    let result;
    switch (form.get("grant_type")) {
      case "authorization_code":
        result = exchangeCode(
          {
            code: required(form, "code"),
            clientId: client.clientId,
            redirectUri: required(form, "redirect_uri"),
            verifier: required(form, "code_verifier"),
          },
          now
        );
        break;
      case "refresh_token": {
        const scope = form.has("scope") ? parseScope(form.get("scope")) : null;
        if (scope === undefined)
          throw new OAuthError(400, "invalid_scope", "Unknown scope.");
        result = refreshTokens(
          {
            refreshToken: required(form, "refresh_token"),
            clientId: client.clientId,
            scope,
          },
          now
        );
        break;
      }
      default:
        throw new OAuthError(
          400,
          "unsupported_grant_type",
          "Use authorization_code or refresh_token."
        );
    }
    if ("error" in result)
      throw new OAuthError(400, result.error, result.description);
    return json(result, 200, { pragma: "no-cache" });
  } catch (error) {
    return respond(error);
  }
}

/** RFC 7009. Always 200 for a known client, whatever the token was. */
export async function revoke(
  request: Request,
  now = Date.now()
): Promise<Response> {
  try {
    requireOAuth();
    const form = await readForm(request);
    limit(request, "token", 60, 1000, now);
    const client = publicClient(form);
    revokeToken(required(form, "token"), client.clientId, now);
    return new Response(null, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return respond(error);
  }
}
