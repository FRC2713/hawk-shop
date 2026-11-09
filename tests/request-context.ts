import { createContext } from "astro/middleware";
import type { APIRoute } from "astro";
import { requestContext, currentRequest } from "../src/server/request-context";
import {
  readSuiteHeaders,
  type SuiteIdentity,
} from "../src/server/suite-identity";

// Fixture Onshape key pair; tests that need it unconfigured delete it locally.
process.env.ONSHAPE_ACCESS_KEY ??= "test-access";
process.env.ONSHAPE_SECRET_KEY ??= "test-secret";
export const ONSHAPE_SIGNATURE = /^On test-access:HmacSHA256:[A-Za-z0-9+/]+=*$/;

// Test-only proxy fixture. Production never reads fixture_suite cookies. The
// real HTTP/runtime tests exercise gateway headers and rejection separately.
export function fixtureIdentity(request: Request): SuiteIdentity | undefined {
  const cookie = request.headers.get("cookie") || "";
  const value = /(?:^|;\s*)fixture_suite=([^;]+)/.exec(cookie)?.[1];
  if (value) return JSON.parse(Buffer.from(value, "base64url").toString());
  return readSuiteHeaders(request.headers, "TRHR");
}

export function sessionRequest(token: string) {
  return new Request("http://localhost/", {
    headers: {
      "x-token-subject": `slack:TRHR:U${token.replace(/[^a-z0-9]/gi, "").toUpperCase()}`,
      "x-hawk-slack-team": "TRHR",
      "x-hawk-slack-user": `U${token.replace(/[^a-z0-9]/gi, "").toUpperCase()}`,
      "x-token-user-roles": "suite/member",
    },
  });
}

export async function inRequest(
  request: Request,
  operation: () => Promise<Response>,
  params: Record<string, string> = {}
) {
  const context = createContext({
    request,
    params,
    defaultLocale: "en",
    locals: { identity: fixtureIdentity(request) },
  });
  return requestContext.run(context, async () => {
    const response = await operation();
    for (const cookie of context.cookies.headers())
      response.headers.append("Set-Cookie", cookie);
    return response;
  });
}

export function getHandler(route: unknown) {
  return async (_context: { request: Request }): Promise<Response> => {
    const result = await (route as { GET: APIRoute }).GET(currentRequest());
    if (!(result instanceof Response))
      throw new Error("Endpoint did not return a response");
    return result;
  };
}
