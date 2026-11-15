import type { TestContext } from "node:test";
import { useOnshapeAdapter } from "../src/lib/onshapeApi/gateway";

/**
 * An in-memory Onshape at the gateway's adapter seam. It records every request
 * that would have left the building and answers with `respond`, so tests count
 * upstream calls directly instead of stubbing `globalThis.fetch`.
 */
export function memoryOnshape(
  t: TestContext,
  respond: (request: Request) => Response | Promise<Response> = () =>
    Response.json({})
) {
  const requests: Request[] = [];
  const restore = useOnshapeAdapter(async (request) => {
    requests.push(request);
    return respond(request);
  });
  t.after(restore);
  return {
    requests,
    paths: () => requests.map((request) => new URL(request.url).pathname),
  };
}
