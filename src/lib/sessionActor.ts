import "virtual:hawk-shop/server-only";
import { currentRequest } from "~/server/request-context";
import { requireAuth } from "~/lib/requireAuth";

// The historical field name is also used by existing cards and Slack records.
// New actors carry Suite subjects; CAD account cookies never identify an actor.
export type SessionActor = { onshape_user_id: string; email: string | null };

export async function getSessionActor(): Promise<SessionActor | null> {
  const identity = currentRequest().locals.identity;
  return identity
    ? { onshape_user_id: identity.subject, email: identity.email ?? null }
    : null;
}

export async function requireSessionActor(): Promise<SessionActor | Response> {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  return (
    (await getSessionActor()) ??
    Response.json(
      { error: "Sign in with Hawk Suite to verify your identity." },
      { status: 401 }
    )
  );
}
