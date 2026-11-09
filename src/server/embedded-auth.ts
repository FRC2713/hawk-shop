import "virtual:hawk-shop/server-only";
import { createHash, randomBytes } from "node:crypto";

export const EMBEDDED_COOKIE = "__Host-hawk-shop-embedded";
const codeLifetimeMs = 60_000;
const pending = new Map<
  string,
  { challenge: string; token: string; expires: number }
>();
const proofPattern = /^[A-Za-z0-9_-]{43}$/;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("base64url");

export function validEmbeddedProof(value: unknown): value is string {
  return typeof value === "string" && proofPattern.test(value);
}

// Only the Suite-gated popup may issue codes. Tokens never enter page scripts,
// postMessage payloads, URLs, or JavaScript-readable storage.
export function issueEmbeddedCode(challenge: string, token: string): string {
  if (!validEmbeddedProof(challenge) || !token || token.length > 16_384)
    throw new Error("Invalid embedded authorization");
  const now = Date.now();
  for (const [key, entry] of pending) {
    if (entry.expires <= now) pending.delete(key);
  }
  if (pending.size >= 1000) throw new Error("Too many pending connections");
  const code = randomBytes(32).toString("base64url");
  pending.set(digest(code), {
    challenge,
    token,
    expires: now + codeLifetimeMs,
  });
  return code;
}

export function redeemEmbeddedCode(code: unknown, verifier: unknown) {
  if (!validEmbeddedProof(code) || !validEmbeddedProof(verifier)) return;
  const key = digest(code);
  const entry = pending.get(key);
  if (!entry) return;
  if (entry.expires <= Date.now()) {
    pending.delete(key);
    return;
  }
  if (entry.challenge !== digest(verifier)) return;
  pending.delete(key);
  return entry.token;
}

export function embeddedCookie(token: string, maxAge = 28_800) {
  return `${EMBEDDED_COOKIE}=${encodeURIComponent(token)}; Path=/; Secure; HttpOnly; SameSite=None; Partitioned; Max-Age=${maxAge}`;
}
