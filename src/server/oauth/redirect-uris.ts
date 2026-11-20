import "virtual:hawk-shop/server-only";
// Redirect URI rules for MCP clients. HTTPS anywhere, or plain HTTP back to an
// app on the same computer (RFC 8252 §7.3). No custom schemes, fragments or
// credentials.

const loopbackHosts = new Set(["127.0.0.1", "[::1]", "localhost"]);

function parse(value: string): URL | undefined {
  if (value.length > 2048 || value.includes("#")) return undefined;
  try {
    const url = new URL(value);
    return url.username || url.password ? undefined : url;
  } catch {
    return undefined;
  }
}

const isLoopback = (url: URL) =>
  url.protocol === "http:" && loopbackHosts.has(url.hostname);

export function validRedirectUri(value: string): boolean {
  const url = parse(value);
  return Boolean(url && (url.protocol === "https:" || isLoopback(url)));
}

/** Exact match, except that a loopback redirect may use any port. */
export function redirectMatches(
  registered: string[],
  requested: string
): boolean {
  if (!validRedirectUri(requested)) return false;
  if (registered.includes(requested)) return true;
  const want = parse(requested)!;
  if (!isLoopback(want)) return false;
  return registered.some((value) => {
    const have = parse(value);
    return (
      have !== undefined &&
      isLoopback(have) &&
      have.hostname === want.hostname &&
      have.pathname === want.pathname &&
      have.search === want.search
    );
  });
}

/** What the consent page shows as the place the code goes. */
export function redirectLabel(value: string): string {
  const url = new URL(value);
  return isLoopback(url) ? `An app on this computer (${url.host})` : url.host;
}
