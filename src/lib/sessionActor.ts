import "virtual:hawk-shop/server-only";
import { currentRequest } from "~/server/request-context";
import { requireAuth } from "~/lib/requireAuth";
import { eq } from "drizzle-orm";
import { db, type Transaction } from "~/server/db/client";
import { users } from "~/server/db/schema";

// The historical field name is also used by existing cards and Slack records.
// New actors carry Suite subjects; CAD account cookies never identify an actor.
export type SessionActor = {
  onshape_user_id: string;
  email: string | null;
  name?: string;
};

/**
 * The name to record for what `actor` did: the identity's name, else the name
 * they last signed in with, else "Unknown member".
 */
export function actorName(
  actor: SessionActor,
  reader: Transaction | typeof db = db
): string {
  return (
    actor.name ||
    reader
      .select({ name: users.name })
      .from(users)
      .where(eq(users.onshape_user_id, actor.onshape_user_id))
      .get()?.name ||
    "Unknown member"
  );
}

export async function getSessionActor(): Promise<SessionActor | null> {
  const identity = currentRequest().locals.identity;
  return identity
    ? {
        onshape_user_id: identity.subject,
        email: identity.email ?? null,
        name: identity.name,
      }
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
