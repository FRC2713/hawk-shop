import "virtual:hawk-shop/server-only";
import { currentRequest } from "~/server/request-context";

/** Every shop operation requires Suite membership, independently of CAD tokens. */
export async function requireAuth(): Promise<Response | null> {
  if (currentRequest().locals.identity) return null;
  return Response.json(
    { error: "Sign in with Hawk Suite to continue." },
    { status: 401 }
  );
}
