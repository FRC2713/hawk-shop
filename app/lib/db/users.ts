import "server-only";

/**
 * User records mirrored from Onshape at sign-in.
 *
 * There is no local account system — a user exists here because they
 * authenticated against Onshape, and the row is only used to render a
 * human-readable name on cards.
 */

import { asc, eq } from "drizzle-orm";
import { db } from "./client";
import { users } from "./schema";
import type { UserRow } from "./types";

/**
 * Upsert a user record (insert or update if exists)
 * @param onshapeUserId - The Onshape user ID (primary key)
 * @param firstName - The user's first name from Onshape (can be null)
 * @param lastName - The user's last name from Onshape (can be null)
 * @returns The user record or null if operation fails
 */
export async function upsertUser(
  onshapeUserId: string,
  firstName: string | null,
  lastName?: string | null
): Promise<UserRow | null> {
  try {
    // Construct name as "FirstName L" where L is the first initial of last name
    let name: string | null = null;
    if (firstName) {
      if (lastName && lastName.length > 0) {
        const lastInitial = lastName.charAt(0).toUpperCase();
        name = `${firstName} ${lastInitial}`;
      } else {
        name = firstName;
      }
    }

    const now = new Date().toISOString();

    const [user] = await db
      .insert(users)
      .values({
        onshape_user_id: onshapeUserId,
        name,
        created_at: now,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: users.onshape_user_id,
        set: { name, updated_at: now },
      })
      .returning();

    return user ?? null;
  } catch (error) {
    console.error("[Users] Exception upserting user:", error);
    return null;
  }
}

/**
 * Get user by Onshape user ID
 * @param onshapeUserId - The Onshape user ID to look up
 * @returns The user's name (first name + last initial) or null if not found
 */
export async function getUserById(
  onshapeUserId: string
): Promise<string | null> {
  const user = await getUserRecordById(onshapeUserId);
  return user?.name || null;
}

/**
 * Get full user record by Onshape user ID
 * @param onshapeUserId - The Onshape user ID to look up
 * @returns The full user record or null if not found
 */
export async function getUserRecordById(
  onshapeUserId: string
): Promise<UserRow | null> {
  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.onshape_user_id, onshapeUserId))
      .limit(1);

    return user ?? null;
  } catch (error) {
    console.error("[Users] Exception fetching user record:", error);
    return null;
  }
}

/**
 * Every user who has signed in, for assignee pickers.
 */
export async function listUsers(): Promise<UserRow[]> {
  return db.select().from(users).orderBy(asc(users.name));
}
