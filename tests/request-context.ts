import { requestHandler } from "@tanstack/start-server-core/request-response";

export function sessionRequest(token: string, expiresAt = Date.now() + 60_000) {
  return new Request("http://localhost/", {
    headers: {
      cookie: `onshape_access_token=${token}; onshape_refresh_token=refresh-${token}; onshape_expires_at=${expiresAt}`,
    },
  });
}

export async function inRequest(
  request: Request,
  operation: () => Promise<Response>
) {
  return requestHandler(operation)(request, undefined);
}

export function getHandler(
  route: unknown
): (context: { request: Request }) => Promise<Response> {
  return (
    route as {
      options: {
        server: {
          handlers: {
            GET: (context: { request: Request }) => Promise<Response>;
          };
        };
      };
    }
  ).options.server.handlers.GET;
}
