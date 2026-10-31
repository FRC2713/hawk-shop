import "@tanstack/react-start/server-only";
import { eq } from "drizzle-orm";
import { db } from "~/lib/db/client";
import { slackConfig, slackPending } from "~/lib/db/schema";

export function getSlackSettings(connection: Pick<typeof db, "select"> = db) {
  return (
    connection
      .select()
      .from(slackConfig)
      .where(eq(slackConfig.id, "default"))
      .get() ?? {
      id: "default",
      channel_id: null,
      channel_name: null,
      enabled: false,
      generation: 0,
      updated_at: new Date(0).toISOString(),
    }
  );
}
export function saveSlackSettings(
  channel_id: string | null,
  channel_name: string | null,
  enabled: boolean
) {
  return db.transaction((tx) => {
    const previous = getSlackSettings(tx);
    const generation =
      previous.generation +
      (previous.channel_id !== channel_id || previous.enabled !== enabled
        ? 1
        : 0);
    const value = {
      id: "default",
      channel_id,
      channel_name,
      enabled,
      generation,
      updated_at: new Date().toISOString(),
    };
    tx.insert(slackConfig)
      .values(value)
      .onConflictDoUpdate({ target: slackConfig.id, set: value })
      .run();
    if (generation !== previous.generation) tx.delete(slackPending).run();
    return value;
  });
}
