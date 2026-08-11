import { createFileRoute } from "@tanstack/react-router";
import { randomBytes } from "node:crypto";
import { getAuthorizationUrl } from "~/lib/onshapeApi/auth";
import { setOAuthState, setOAuthRedirect } from "~/lib/onshapeAuth";
import { refreshOnshapeTokenIfNeeded } from "~/lib/tokenRefresh";
import { resolveAppOrigin } from "~/lib/appOrigin";
import { redirectResponse } from "~/lib/httpRedirect";
import { safeRedirectPath } from "~/lib/safeRedirect";

export const Route = createFileRoute("/auth/onshape/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        // Sanitised up front: this value is attacker-supplied, gets parked in a
        // cookie for the OAuth round trip, and is later resolved against the
        // app origin — where an absolute URL would replace that origin outright.
        const redirectTo = safeRedirectPath(url.searchParams.get("redirect"));

        console.log("[AUTH ONSHAPE] ===== Starting Onshape Auth Flow =====");
        console.log("[AUTH ONSHAPE] Request URL:", request.url);
        console.log("[AUTH ONSHAPE] URL origin:", url.origin);
        console.log("[AUTH ONSHAPE] URL host:", url.host);
        console.log("[AUTH ONSHAPE] URL hostname:", url.hostname);
        console.log("[AUTH ONSHAPE] URL protocol:", url.protocol);
        console.log("[AUTH ONSHAPE] NODE_ENV:", process.env.NODE_ENV);
        console.log(
          "[AUTH ONSHAPE] ONSHAPE_REDIRECT_URI env:",
          process.env.ONSHAPE_REDIRECT_URI || "(not set)"
        );
        console.log(
          "[AUTH ONSHAPE] Request headers.host:",
          request.headers.get("host")
        );
        console.log(
          "[AUTH ONSHAPE] Request headers.x-forwarded-host:",
          request.headers.get("x-forwarded-host")
        );
        console.log(
          "[AUTH ONSHAPE] Request headers.x-forwarded-proto:",
          request.headers.get("x-forwarded-proto")
        );
        console.log("[AUTH ONSHAPE] redirectTo param:", redirectTo);

        // Check if already authenticated.
        //
        // This has to agree with the two places that gate the app — the request
        // middleware in `app/start.ts` and the `_main` loader — and both of
        // them treat an *expired* token as signed out. Testing mere cookie
        // presence here did not: an expired-but-present token made this route
        // answer "already authenticated" and bounce the user to `?auth=success`,
        // where the loader immediately disagreed and sent them straight back
        // here. That is an infinite redirect loop, and the page never loads.
        //
        // Refreshing first also repairs the common case rather than forcing a
        // re-login: a token that is merely stale gets renewed. When the refresh
        // token is gone or rejected this returns null (having cleared the dead
        // cookies), and we fall through to a full OAuth round trip.
        const accessToken = await refreshOnshapeTokenIfNeeded();
        console.log("[AUTH ONSHAPE] Already authenticated:", !!accessToken);
        if (accessToken) {
          // `redirectTo` is already reduced to a rooted same-origin path, and
          // the cookies we just confirmed (or renewed) are what the gate reads
          // on the way back in — no `?auth=success` tag needed, and none is
          // trusted any more.
          const redirectUrl = new URL(redirectTo, resolveAppOrigin(request));
          console.log(
            "[AUTH ONSHAPE] Redirecting authenticated user to:",
            redirectUrl.toString()
          );
          return redirectResponse(redirectUrl.toString());
        }

        const clientId = process.env.ONSHAPE_CLIENT_ID;
        console.log(
          "[AUTH ONSHAPE] ONSHAPE_CLIENT_ID:",
          clientId ? `${clientId.substring(0, 8)}...` : "(not set)"
        );

        // Dynamically construct redirect URI from request URL
        // Falls back to environment variable if set (for backwards compatibility)
        const redirectUri =
          process.env.ONSHAPE_REDIRECT_URI ||
          `${url.origin}/auth/onshape/callback`;

        console.log("[AUTH ONSHAPE] Constructed redirectUri:", redirectUri);
        console.log(
          "[AUTH ONSHAPE] Using env ONSHAPE_REDIRECT_URI:",
          !!process.env.ONSHAPE_REDIRECT_URI
        );

        if (!clientId) {
          throw new Error("Missing ONSHAPE_CLIENT_ID environment variable");
        }

        // Store the redirect destination before starting OAuth
        await setOAuthRedirect(redirectTo);
        console.log("[AUTH ONSHAPE] Stored redirect destination:", redirectTo);

        // Generate state for CSRF protection
        const state = randomBytes(32).toString("hex");
        await setOAuthState(state);
        console.log(
          "[AUTH ONSHAPE] Generated OAuth state:",
          state.substring(0, 16) + "..."
        );

        // Generate authorization URL
        const authUrl = getAuthorizationUrl(redirectUri, clientId, state);
        console.log("[AUTH ONSHAPE] Generated authorization URL:", authUrl);

        // Redirect to authorization URL
        console.log("[AUTH ONSHAPE] ===== Redirecting to Onshape OAuth =====");
        return redirectResponse(authUrl);
      },
    },
  },
});
