import { z } from "zod";

export type SuiteIdentity = {
  subject: string;
  teamId: string;
  userId: string;
  name?: string;
  email?: string;
};

const settingsSchema = z
  .object({
    HAWK_SUITE_TRUST_PROXY: z.enum(["true", "false"]).default("false"),
    HAWK_SUITE_TEAM_ID: z
      .string()
      .regex(/^T[A-Z0-9]+$/)
      .optional(),
    HAWK_SUITE_ISSUER: z.string().url().optional(),
  })
  .refine(
    (value) =>
      value.HAWK_SUITE_TRUST_PROXY !== "true" ||
      Boolean(value.HAWK_SUITE_TEAM_ID && value.HAWK_SUITE_ISSUER),
    "Suite proxy authentication requires a workspace ID and issuer."
  );

export function suiteSettings() {
  return settingsSchema.parse({
    HAWK_SUITE_TRUST_PROXY: process.env.HAWK_SUITE_TRUST_PROXY,
    HAWK_SUITE_TEAM_ID: process.env.HAWK_SUITE_TEAM_ID || undefined,
    HAWK_SUITE_ISSUER: process.env.HAWK_SUITE_ISSUER || undefined,
  });
}

// Same contract as Hawk Eye. Caddy must remove caller identity headers before
// authorization and the app port must only be reachable from that gateway.
export function readSuiteHeaders(
  headers: Headers,
  expectedTeam: string
): SuiteIdentity | undefined {
  const subject = headers.get("x-token-subject");
  const teamId = headers.get("x-hawk-slack-team");
  const userId = headers.get("x-hawk-slack-user");
  const roles = headers.get("x-token-user-roles");
  if (!teamId || !/^T[A-Z0-9]+$/.test(teamId) || teamId !== expectedTeam)
    return;
  if (!userId || !/^[UW][A-Z0-9]+$/.test(userId)) return;
  if (subject !== `slack:${teamId}:${userId}`) return;
  if (
    !roles ||
    roles.length > 2048 ||
    !/^[a-zA-Z0-9_:/.-]+(?: +[a-zA-Z0-9_:/.-]+)*$/.test(roles) ||
    !roles.split(/ +/).includes("suite/member")
  )
    return;
  const display = (name: string) => {
    const value = headers.get(name)?.trim();
    return value && value.length <= 256 && !value.includes(",")
      ? value
      : undefined;
  };
  return {
    subject: subject!,
    teamId,
    userId,
    name: display("x-token-user-name"),
    email: display("x-token-user-email"),
  };
}

export function suiteIdentity(request: Request): SuiteIdentity | undefined {
  const settings = suiteSettings();
  return settings.HAWK_SUITE_TRUST_PROXY === "true"
    ? readSuiteHeaders(request.headers, settings.HAWK_SUITE_TEAM_ID!)
    : undefined;
}

export function suiteUrl(
  path: "auth/" | "auth/logout" | "auth/portal"
): string | undefined {
  const issuer = suiteSettings().HAWK_SUITE_ISSUER;
  return issuer ? new URL(path, issuer).href : undefined;
}
