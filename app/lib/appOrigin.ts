import "server-only";

/**
 * The origin the browser actually reached us on.
 *
 * `new URL(request.url).origin` is the obvious way to build a redirect back into
 * the app, and it is wrong in the standalone container: Next builds `request.url`
 * from HOSTNAME — the *bind* address, `0.0.0.0` — not from the Host header. A
 * browser on http://localhost:3000 therefore gets redirected to
 * http://0.0.0.0:3000, which is a different origin, so the auth cookies just
 * written on localhost are invisible from that point on. Every subsequent
 * navigation reads as signed-out.
 *
 * The Host header is the origin whose cookie jar we just wrote, so it wins.
 * APP_URL covers the case where a proxy strips Host, and `request.url` is the
 * last resort.
 */
export function resolveAppOrigin(request: Request): string {
  const host =
    request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (host) {
    const proto =
      request.headers.get("x-forwarded-proto") ||
      new URL(request.url).protocol.replace(":", "");
    return `${proto}://${host}`;
  }

  const configured = process.env.APP_URL;
  if (configured) return new URL(configured).origin;

  return new URL(request.url).origin;
}
