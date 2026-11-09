/**
 * The browser's entire view of `/api/*`.
 *
 * Components import from here rather than calling `fetch` themselves, so a URL,
 * a payload shape, and a query key each exist in exactly one place. Everything
 * under this directory is client-safe — no `server-only` imports.
 */
export { ApiError, apiFetch, searchParams } from "./client";
export { queryKeys } from "./keys";

export * from "./equipment";
export * from "./processes";
export * from "./users";
export * from "./kanban";
export * from "./onshape";

/** Namespaced: its function names (`addCard`, `moveCard`) are generic enough to collide. */
export * as partActions from "./partActions";
