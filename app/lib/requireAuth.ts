import "@tanstack/react-start/server-only";
import { isOnshapeAuthenticated } from "~/lib/onshapeAuth";

/**
 * Gate a server route handler on a valid Onshape session.
 *
 * The request middleware in `app/start.ts` deliberately lets every `/api/*`
 * request through, on the stated understanding that the handler re-verifies.
 * The Onshape-proxying handlers effectively did, because they cannot function
 * without a token — but the DB-backed ones never checked anything, so
 * `/api/kanban/cards`, `/api/users`, `/api/equipment` and friends answered any
 * caller on the network, reads *and* writes alike. This is the missing check.
 *
 * Deliberately does not refresh. `refreshOnshapeTokenIfNeeded` rotates the
 * refresh token, and a board view fires several of these at once — a stampede
 * of parallel refreshes would race to invalidate each other's rotated token and
 * sign the user out. Renewal stays where exactly one request can drive it: the
 * `/auth/onshape` route the loader bounces through.
 *
 * Returns a 401 to hand straight back, or null when the caller may proceed.
 */
export async function requireAuth(): Promise<Response | null> {
  if (await isOnshapeAuthenticated()) return null;

  return Response.json(
    { error: "Not authenticated with Onshape" },
    { status: 401 }
  );
}
