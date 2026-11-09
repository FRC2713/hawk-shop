import "virtual:hawk-shop/server-only";
import { randomUUID } from "node:crypto";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "~/server/db/client";
import { problemReports } from "~/server/db/schema";
import type { SuiteIdentity } from "~/server/suite-identity";
import { getSlackSettings } from "./settings";
import { slackAppBaseUrl } from "./appUrl";
import { postSlackMessage } from "./messages";
import {
  SlackError,
  slackCall,
  slackEnvironment,
  slackCooldown,
} from "./client";

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const field = (context: Record<string, unknown>, key: string, limit: number) =>
  typeof context[key] === "string" ? context[key].slice(0, limit) : "";
export function reportsEnabled() {
  const settings = getSlackSettings();
  return settings.reports_enabled;
}
export function queueProblemReport(
  identity: SuiteIdentity,
  message: string,
  context: Record<string, unknown>
) {
  const settings = getSlackSettings();
  const channel = settings.reports_channel_id || settings.channel_id;
  if (!settings.reports_enabled)
    return Response.json(
      { error: "Problem reports are disabled." },
      { status: 404 }
    );
  if (!channel)
    return Response.json(
      {
        error:
          "A report channel has not been configured. Please tell a mentor.",
      },
      { status: 503 }
    );
  const id = randomUUID();
  const now = Date.now();
  // Queries and fragments may contain credentials or other private data.
  const path = field(context, "page_path", 1000).split(/[?#]/)[0];
  const page = new URL("/", slackAppBaseUrl().origin);
  page.pathname = path.startsWith("/") ? path : "/";
  const details = [
    "Problem report " + id,
    "Member: " + escape(identity.name || identity.email || "Suite member"),
    "Member ID: " + escape(identity.subject),
    "Message: " + escape(message),
    "Page: <" + page.href.replace(/\|/g, "%7C") + "|Open page in Hawk Shop>",
    field(context, "card_id", 128)
      ? "Card link: <" +
        new URL(
          "/kanban?cardId=" +
            encodeURIComponent(field(context, "card_id", 128)),
          slackAppBaseUrl().origin
        ).href +
        "|Open card in Hawk Shop>"
      : "",
    ...[
      ["card_id", "Card", 128],
      ["error_id", "Error ID", 128],
      ["error_message", "Error", 1000],
      ["user_agent", "Browser", 300],
      ["viewport", "Viewport", 40],
    ].map(([key, label, limit]) => {
      const value = field(context, String(key), Number(limit));
      return value ? label + ": " + escape(value) : "";
    }),
    "Version: " +
      escape((process.env.APP_REVISION || "development").slice(0, 128)),
    "Time: " + new Date(now).toISOString(),
  ]
    .filter(Boolean)
    .join("\n");
  return db.transaction((tx) => {
    const recent = tx
      .select({ id: problemReports.id })
      .from(problemReports)
      .where(
        and(
          eq(problemReports.member_id, identity.subject),
          gte(problemReports.created_at, new Date(now - 600000).toISOString())
        )
      )
      .all();
    if (recent.length >= 5)
      return Response.json(
        { error: "Please wait ten minutes before sending another report." },
        { status: 429, headers: { "Retry-After": "600" } }
      );
    tx.insert(problemReports)
      .values({
        id,
        member_id: identity.subject,
        channel_id: channel,
        text: details,
        created_at: new Date(now).toISOString(),
        expires_at: new Date(now + 7 * 86400000).toISOString(),
        next_attempt_at: new Date(now).toISOString(),
      })
      .run();
    return Response.json({ report_id: id }, { status: 202 });
  });
}

// Called by the single Slack worker; uses the same transport, method cooldown,
// and post-spacing gate as status notifications and administrator test messages.
export async function deliverProblemReports(now: () => number) {
  const expired = db
    .select()
    .from(problemReports)
    .where(
      and(
        lte(problemReports.expires_at, new Date(now()).toISOString()),
        isNull(problemReports.delivered_at)
      )
    )
    .all();
  for (const row of expired)
    console.error("[REPORTS] Delivery window expired", row.id);
  db.delete(problemReports)
    .where(lte(problemReports.expires_at, new Date(now()).toISOString()))
    .run();
  if (!reportsEnabled()) return;
  for (const row of db
    .select()
    .from(problemReports)
    .where(
      and(
        isNull(problemReports.delivered_at),
        lte(problemReports.next_attempt_at, new Date(now()).toISOString())
      )
    )
    .all()) {
    if (
      Math.max(
        slackCooldown("post_spacing"),
        slackCooldown("method:chat.postMessage")
      ) > now()
    )
      break;
    try {
      const { workspace } = slackEnvironment();
      const auth = await slackCall<{ team_id?: string; bot_id?: string }>(
        "auth.test"
      );
      if (auth.team_id !== workspace || !auth.bot_id)
        throw new SlackError("workspace_mismatch");
      if (!reportsEnabled()) break;
      await postSlackMessage(row.channel_id, row.text);
      db.update(problemReports)
        .set({ delivered_at: new Date(now()).toISOString(), error_code: null })
        .where(eq(problemReports.id, row.id))
        .run();
    } catch (error) {
      const failure =
        error instanceof SlackError ? error : new SlackError("unavailable");
      console.error("[REPORTS] Delivery deferred", row.id, failure.code);
      const delay = Math.max(
        (failure.retryAfterSeconds || 0) * 1000,
        Math.min(3600000, 1000 * 2 ** Math.min(row.attempts, 12))
      );
      db.update(problemReports)
        .set({
          attempts: row.attempts + 1,
          error_code: failure.code,
          next_attempt_at: new Date(
            Math.min(Date.parse(row.expires_at), now() + delay)
          ).toISOString(),
        })
        .where(eq(problemReports.id, row.id))
        .run();
    }
  }
}
