import "virtual:hawk-shop/server-only";
import { db } from "~/server/db/client";
import { users } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import type { SessionActor } from "~/lib/sessionActor";
import {
  requireOAuth,
  resourceMetadataUrl,
  oauthScopes,
  type OAuthScope,
} from "~/server/oauth/settings";
import { principalForAccessToken, audit } from "~/server/oauth/store";
import { ApiError } from "~/server/oauth/http";
import { suiteSettings } from "~/server/suite-identity";

export type Scope = OAuthScope;
export type Principal = {
  actor: SessionActor;
  scopes: Scope[];
  clientId: string;
  grantId: number;
};
export class McpHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {}
  ) {
    super(message);
  }
}

/** OAuth access tokens authorize only MCP, independently of browser sessions. */
export async function authenticateMcp(request: Request): Promise<Principal> {
  try {
    requireOAuth();
  } catch (error) {
    if (error instanceof ApiError)
      throw new McpHttpError(error.status, error.message);
    throw error;
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(process.env.APP_URL!).origin)
    throw new McpHttpError(403, "Request origin is not allowed");
  const unauthenticated = () =>
    new McpHttpError(401, "Connect this app to Hawk Shop to continue", {
      "WWW-Authenticate":
        `Bearer resource_metadata="${resourceMetadataUrl()}", scope="${oauthScopes.join(" ")}"` +
        (request.headers.has("authorization") ? ', error="invalid_token"' : ""),
    });
  const match = /^Bearer (hsk_at_[A-Za-z0-9_-]{43})$/i.exec(
    request.headers.get("authorization") || ""
  );
  const principal = match && principalForAccessToken(match[1], Date.now());
  if (!principal) throw unauthenticated();
  const team = suiteSettings().HAWK_SUITE_TEAM_ID;
  if (!principal.subject.startsWith(`slack:${team}:`)) throw unauthenticated();
  const member = db
    .select()
    .from(users)
    .where(eq(users.onshape_user_id, principal.subject))
    .get();
  if (!member) throw unauthenticated();
  return {
    actor: {
      onshape_user_id: principal.subject,
      email: member.email,
      name: member.name ?? undefined,
    },
    scopes: principal.scope,
    clientId: principal.clientId,
    grantId: principal.grantId,
  };
}
export function recordToolCall(principal: Principal, tool: string) {
  audit("tool_call", Date.now(), {
    subject: principal.actor.onshape_user_id,
    clientId: principal.clientId,
    grantId: principal.grantId,
    detail: tool,
  });
}
