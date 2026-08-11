import { createMiddleware, createStart } from "@tanstack/react-start";
import { isOnshapeAuthenticatedFromRequest } from "~/lib/onshapeAuthRequest";

/**
 * Global auth gate. This is the TanStack Start equivalent of the Next
 * `proxy.ts` middleware, and it keeps that file's behaviour verbatim:
 *
 * - `/signin` and `/auth/*` are public.
 * - Every `/api/*` and `/_serverFn/*` request is let through, because the
 *   handlers re-verify themselves — `requireAuth()` on the DB-backed routes,
 *   and a token requirement on the Onshape-proxying ones. `/_serverFn/*` in
 *   particular must stay open: redirecting it would break
 *   `fetchOnshapeAuthState`, whose whole job is to answer "am I signed in?"
 *   while signed out.
 *
 * There used to be a third rule here: `?auth=success` skipped the check
 * outright, on the theory that cookies are unreliable to read at this layer
 * inside Onshape's iframe. It was a query parameter anyone could type, and it
 * let an unauthenticated request walk into any page in the app. It is gone, and
 * the auth routes no longer tag their redirects with it. The loop it was
 * papering over came from the gates disagreeing about expiry, which is now
 * settled in one place — see `hasUsableSession`.
 * - Anything else without valid cookies is redirected into the Onshape OAuth
 *   flow, carrying the original path so we can come back to it.
 *
 * Unlike Next's `config.matcher`, request middleware sees every request, so the
 * static-asset exclusions the matcher expressed are spelled out below.
 */
const PUBLIC_PREFIXES = ["/signin", "/auth/"];

/** Handled server-side, and verified there rather than here. */
const SERVER_VERIFIED_PREFIXES = ["/api/", "/_serverFn/"];

/** Vite/Nitro internals and built assets — never gated. */
const ASSET_PREFIXES = ["/_build/", "/@", "/node_modules/", "/__"];
const ASSET_EXTENSIONS =
  /\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|mjs|map|woff|woff2|ttf|otf)$/;

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }
  if (ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }
  return ASSET_EXTENSIONS.test(pathname);
}

const onshapeAuthGate = createMiddleware({ type: "request" }).server(
  async ({ request, next }) => {
    const { pathname, searchParams } = new URL(request.url);

    if (isPublicPath(pathname)) {
      return next();
    }

    if (isOnshapeAuthenticatedFromRequest(request)) {
      return next();
    }

    // Route handlers read cookies directly, which is more reliable than parsing
    // them here in an iframe context, so they verify auth themselves.
    if (
      SERVER_VERIFIED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    ) {
      console.log(
        "[PROXY] Server-handled route - allowing request through (handler verifies auth via cookies)"
      );
      return next();
    }

    const query = searchParams.toString();
    const fullPath = `${pathname}${query ? `?${query}` : ""}`;
    const authUrl = new URL("/auth/onshape", request.url);
    authUrl.searchParams.set("redirect", fullPath);

    console.log(
      "[PROXY] Page route not authenticated, redirecting to Onshape auth"
    );
    console.log("[PROXY] Full path:", fullPath);

    return new Response(null, {
      status: 302,
      headers: { Location: authUrl.toString() },
    });
  }
);

export const startInstance = createStart(() => ({
  requestMiddleware: [onshapeAuthGate],
}));
