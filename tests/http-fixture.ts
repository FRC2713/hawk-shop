import assert from "node:assert/strict";
import { requestHandler } from "@tanstack/start-server-core/request-response";
const { Route: callback } = await import("../app/routes/auth/onshape.callback");
type RouteHandler = (context: {
  request: Request;
  params: Record<string, string>;
}) => Promise<Response>;
export function endpoint(
  route: unknown,
  method: string,
  params: Record<string, string> = {}
) {
  const handler = (
    route as { options: { server: { handlers: Record<string, RouteHandler> } } }
  ).options.server.handlers[method];
  return requestHandler((request) => handler({ request, params }));
}

process.env.ONSHAPE_CLIENT_ID = "test-client";
process.env.ONSHAPE_CLIENT_SECRET = "test-secret";
let signInCount = 0;
export async function signIn(email: string | null = "alice@example.com") {
  const token = `access-${++signInCount}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/oauth/token"))
      return Response.json({
        access_token: token,
        refresh_token: `refresh-${signInCount}`,
        expires_in: 3600,
      });
    if (url.endsWith("/users/current"))
      return Response.json({
        id: "alice",
        firstName: "Alice",
        email: email ?? undefined,
      });
    throw new Error(`Unexpected upstream request: ${url}`);
  };
  try {
    const response = await endpoint(callback, "GET")(
      new Request(
        "http://localhost/auth/onshape/callback?code=test&state=test",
        { headers: { Cookie: "onshape_oauth_state=test" } }
      ),
      {}
    );
    assert.equal(response.status, 302);
    return response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
  } finally {
    globalThis.fetch = originalFetch;
  }
}
export function jsonRequest(
  url: string,
  method: string,
  cookie: string,
  body: unknown
) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      ...(url.startsWith("/api/slack/")
        ? { Origin: "http://localhost", "X-Hawk-Shop-Slack": "1" }
        : {}),
    },
    body: JSON.stringify(body),
  });
}
