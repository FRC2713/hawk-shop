import type { APIRoute } from "astro";
import { inRequest } from "./request-context";
import { currentRequest } from "../src/server/request-context";
import type { SuiteIdentity } from "../src/server/suite-identity";

export function endpoint(
  route: Record<string, APIRoute>,
  method: string,
  params: Record<string, string> = {}
) {
  return (request: Request, _context: unknown = {}) =>
    inRequest(
      request,
      async () => {
        const response = await route[method](currentRequest());
        if (!(response instanceof Response))
          throw new Error("Endpoint did not return a response");
        return response;
      },
      params
    );
}

export async function signIn(
  email: string | null = "alice@example.com",
  id = "alice",
  _redirect?: string
) {
  const userId = `U${id.replace(/[^a-z0-9]/gi, "").toUpperCase()}`;
  const identity: SuiteIdentity = {
    subject: `slack:TRHR:${userId}`,
    teamId: "TRHR",
    userId,
    name: id === "alice" ? "Alice" : id,
    email: email ?? undefined,
  };
  const { upsertUser } = await import("../src/server/db/users");
  await upsertUser(identity.subject, identity.name!, null, email);
  const value = Buffer.from(JSON.stringify(identity)).toString("base64url");
  return `fixture_suite=${value}`;
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
      Origin: "http://localhost",
      ...(url.startsWith("/api/slack/") ? { "X-Hawk-Shop-Slack": "1" } : {}),
    },
    body: JSON.stringify(body),
  });
}
