import "virtual:hawk-shop/server-only";
import { suiteSettings } from "~/server/suite-identity";
import { ApiError } from "./http";

export const oauthScopes = ["shop:read", "shop:manage"] as const;
export type OAuthScope = (typeof oauthScopes)[number];
export const scopeLabels: Record<OAuthScope, string> = {
  "shop:read": "Read released work, machines, queues and stations",
  "shop:manage": "Assign machines, prioritize queues and change work status",
};
const minute = 60_000;
export const PENDING_TTL = 10 * minute;
export const CODE_TTL = minute;
export const ACCESS_TTL = 60 * minute;
export const GRANT_TTL = 7 * 24 * 60 * minute;
export const UNUSED_CLIENT_TTL = 24 * 60 * minute;
export const oauthEnabled = () => process.env.MCP_OAUTH_ENABLED === "true";
export function requireOAuth() {
  if (!oauthEnabled())
    throw new ApiError(404, "not_found", "MCP OAuth is disabled");
  let valid = false;
  try {
    const settings = suiteSettings();
    const url = new URL(process.env.APP_URL || "");
    valid =
      settings.HAWK_SUITE_TRUST_PROXY === "true" &&
      url.protocol === "https:" &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password;
  } catch {}
  if (!valid)
    throw new ApiError(
      503,
      "configuration_error",
      "MCP OAuth requires the trusted Suite gateway and an HTTPS APP_URL origin"
    );
}
export const issuer = () => new URL(process.env.APP_URL!).origin;
export const mcpResource = () => `${issuer()}/mcp`;
export const resourceMetadataUrl = () =>
  `${issuer()}/.well-known/oauth-protected-resource/mcp`;
export function parseScope(value: string | null): OAuthScope[] | undefined {
  if (value === null || value.trim() === "") return [...oauthScopes];
  const requested = [...new Set(value.trim().split(/ +/))];
  if (requested.some((s) => !(oauthScopes as readonly string[]).includes(s)))
    return undefined;
  return oauthScopes.filter((s) => requested.includes(s));
}
