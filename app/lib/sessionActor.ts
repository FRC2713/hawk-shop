import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "~/lib/db/client";
import { oauthSessions } from "~/lib/db/schema";
import { getOnshapeTokens } from "~/lib/onshapeAuth";
import {
  hasUsableSession,
  type OnshapeSession,
} from "~/lib/onshapeAuthRequest";
import { requireAuth } from "~/lib/requireAuth";

export type SessionActor = { onshape_user_id: string; email: string | null };
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function establishSessionActor(
  session: OnshapeSession,
  actor: SessionActor
) {
  if (!session.accessToken || !session.refreshToken || !session.expiresAt)
    throw new Error("Missing OAuth tokens");
  db.delete(oauthSessions)
    .where(lt(oauthSessions.refresh_expires_at, new Date().toISOString()))
    .run();
  db.insert(oauthSessions)
    .values({
      access_hash: hash(session.accessToken),
      refresh_hash: hash(session.refreshToken),
      onshape_user_id: actor.onshape_user_id,
      email: actor.email,
      expires_at: new Date(session.expiresAt).toISOString(),
      refresh_expires_at: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000
      ).toISOString(),
    })
    .onConflictDoUpdate({
      target: oauthSessions.access_hash,
      set: {
        onshape_user_id: actor.onshape_user_id,
        email: actor.email,
        expires_at: new Date(session.expiresAt).toISOString(),
      },
    })
    .run();
}

export async function getSessionActor(): Promise<SessionActor | null> {
  const session = await getOnshapeTokens();
  if (!hasUsableSession(session)) return null;
  const row = db
    .select()
    .from(oauthSessions)
    .where(eq(oauthSessions.access_hash, hash(session.accessToken!)))
    .get();
  if (
    !row ||
    !hasUsableSession({ ...session, expiresAt: Date.parse(row.expires_at) })
  )
    return null;
  return { onshape_user_id: row.onshape_user_id, email: row.email };
}

export async function requireSessionActor(): Promise<SessionActor | Response> {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  return (
    (await getSessionActor()) ??
    Response.json(
      { error: "Sign in again to verify your identity" },
      { status: 401 }
    )
  );
}

export async function revokeSessionActor(session: OnshapeSession) {
  if (session.accessToken)
    db.delete(oauthSessions)
      .where(eq(oauthSessions.access_hash, hash(session.accessToken)))
      .run();
}

// A refresh token may renew an expired access token, but only the matching
// server-recorded token pair can carry its verified identity forward.
export async function getRenewableSessionActor(
  session: OnshapeSession
): Promise<SessionActor | null> {
  if (!session.accessToken || !session.refreshToken) return null;
  const row = db
    .select()
    .from(oauthSessions)
    .where(
      and(
        eq(oauthSessions.access_hash, hash(session.accessToken)),
        eq(oauthSessions.refresh_hash, hash(session.refreshToken))
      )
    )
    .get();
  if (!row || Date.parse(row.refresh_expires_at) <= Date.now()) return null;
  return { onshape_user_id: row.onshape_user_id, email: row.email };
}

export async function renewSessionActor(
  previous: OnshapeSession,
  next: OnshapeSession
) {
  const actor = await getRenewableSessionActor(previous);
  await revokeSessionActor(previous);
  if (actor) await establishSessionActor(next, actor);
}
