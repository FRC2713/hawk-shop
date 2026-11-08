import { AsyncLocalStorage } from "node:async_hooks";
import type { APIContext } from "astro";

// Integration helpers share Astro's request-scoped cookie jar. AsyncLocalStorage
// keeps concurrent OAuth callbacks and board requests isolated.
export const requestContext = new AsyncLocalStorage<APIContext>();

export function currentRequest(): APIContext {
  const context = requestContext.getStore();
  if (!context) throw new Error("This operation requires an HTTP request.");
  return context;
}

export function getCookie(name: string): string | undefined {
  try {
    return currentRequest().cookies.get(name)?.value;
  } catch {
    return undefined;
  }
}

export function setCookie(
  name: string,
  value: string,
  options: Parameters<APIContext["cookies"]["set"]>[2]
): void {
  currentRequest().cookies.set(name, value, options);
}

export function deleteCookie(name: string): void {
  currentRequest().cookies.delete(name, { path: "/" });
}
