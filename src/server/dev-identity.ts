import type { SuiteIdentity } from "./suite-identity";

// Local development sign-in. src/middleware.ts imports this module only inside
// an `import.meta.env.DEV` branch, so a production build contains none of it
// and HAWK_SHOP_DEV_SIGNIN does nothing there.
export const DEV_IDENTITY: SuiteIdentity = Object.freeze({
  subject: "slack:TLOCALDEV:ULOCALDEV",
  teamId: "TLOCALDEV",
  userId: "ULOCALDEV",
  name: "Local Developer",
  email: "dev@localhost",
});

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// Fails closed: the explicit flag, proxy trust off (never mix with gateway
// headers) and a loopback client, so `astro dev --host` does not sign in the LAN.
export function devIdentity(
  env: Record<string, string | undefined>,
  clientAddress: string | undefined
): SuiteIdentity | undefined {
  if (env.HAWK_SHOP_DEV_SIGNIN !== "true") return;
  if (env.HAWK_SUITE_TRUST_PROXY === "true") return;
  if (!clientAddress || !LOOPBACK.has(clientAddress)) return;
  return { ...DEV_IDENTITY };
}
