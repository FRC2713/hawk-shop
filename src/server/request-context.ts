import { AsyncLocalStorage } from "node:async_hooks";
import type { APIContext } from "astro";

// Server helpers read the verified Suite identity from the current request.
// AsyncLocalStorage keeps concurrent requests isolated.
export const requestContext = new AsyncLocalStorage<APIContext>();

export function currentRequest(): APIContext {
  const context = requestContext.getStore();
  if (!context) throw new Error("This operation requires an HTTP request.");
  return context;
}
