import { createServerFn } from "@tanstack/react-start";
import { isOnshapeAuthenticated } from "~/lib/onshapeAuth";

/**
 * Route loaders run on the server during SSR and in the browser on client-side
 * navigation, so anything cookie-backed has to go through a server function
 * rather than being read inline the way a Next server component did.
 */
export const fetchOnshapeAuthState = createServerFn().handler(async () => {
  return { isAuthenticated: await isOnshapeAuthenticated() };
});
