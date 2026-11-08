/**
 * Reduce a caller-supplied `redirect` value to a same-origin path.
 *
 * The auth routes take this from a query param (and from the cookie they park
 * it in) and resolve it against the app origin with `new URL(value, origin)`.
 * An absolute or protocol-relative value simply *replaces* that origin, so
 * `?redirect=https://evil.example/` walked the user off-site the moment their
 * session was minted. Only a plain rooted path survives; anything else becomes
 * "/".
 *
 * Client-safe on purpose — no `server-only` marker — so the value can be
 * sanitised on either side of the wire.
 */

/**
 * C0 controls and DEL. Checked by code point rather than a regex literal so the
 * bytes never have to appear in this file.
 */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function safeRedirectPath(value: string | null | undefined): string {
  if (!value) return "/";
  if (value === "/") return "/";

  // Must be rooted, and the character after the slash must not turn it back
  // into an origin: "//evil.example" is protocol-relative, and browsers
  // normalise the backslash in "/\evil.example" to the same thing.
  if (!/^\/[^/\\]/.test(value)) return "/";

  // A line break here would let the caller append their own response headers.
  if (hasControlCharacter(value)) return "/";

  // Bouncing back into the auth routes just restarts the flow we came from.
  if (value.startsWith("/auth/") || value.startsWith("/signin")) return "/";

  return value;
}
