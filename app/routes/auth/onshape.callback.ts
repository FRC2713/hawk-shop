import { createFileRoute } from "@tanstack/react-router";
import { exchangeCodeForToken, onshapeApiRequest } from "~/lib/onshapeApi/auth";
import {
  clearOAuthRedirect,
  clearOAuthState,
  clearOnshapeTokens,
  getOAuthRedirect,
  getOAuthState,
  setOnshapeTokens,
} from "~/lib/onshapeAuth";
import { upsertUser } from "~/lib/db/users";
import { resolveAppOrigin } from "~/lib/appOrigin";
import { redirectResponse } from "~/lib/httpRedirect";
import { safeRedirectPath } from "~/lib/safeRedirect";

/**
 * Send an OAuth failure to /signin, never to "/".
 *
 * "/" is gated by the auth middleware, so redirecting a failure there bounces
 * straight back into /auth/onshape, which re-requests the same broken
 * authorization and fails identically — an infinite redirect loop that hides the
 * actual error. /signin is public, so the message survives long enough to be
 * read.
 */
function authFailure(message: string): Response {
  return redirectResponse("/signin?error=" + encodeURIComponent(message));
}

export const Route = createFileRoute("/auth/onshape/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        console.log("[AUTH CALLBACK] ===== Onshape OAuth Callback =====");
        console.log("[AUTH CALLBACK] Request URL:", request.url);
        console.log("[AUTH CALLBACK] URL origin:", url.origin);
        console.log("[AUTH CALLBACK] URL host:", url.host);
        console.log("[AUTH CALLBACK] URL hostname:", url.hostname);
        console.log("[AUTH CALLBACK] URL protocol:", url.protocol);
        console.log("[AUTH CALLBACK] NODE_ENV:", process.env.NODE_ENV);
        console.log(
          "[AUTH CALLBACK] ONSHAPE_REDIRECT_URI env:",
          process.env.ONSHAPE_REDIRECT_URI || "(not set)"
        );
        console.log(
          "[AUTH CALLBACK] Request headers.host:",
          request.headers.get("host")
        );
        console.log(
          "[AUTH CALLBACK] Request headers.x-forwarded-host:",
          request.headers.get("x-forwarded-host")
        );
        console.log(
          "[AUTH CALLBACK] Request headers.x-forwarded-proto:",
          request.headers.get("x-forwarded-proto")
        );
        console.log(
          "[AUTH CALLBACK] Query params - code:",
          code ? `${code.substring(0, 16)}...` : "(missing)"
        );
        console.log(
          "[AUTH CALLBACK] Query params - state:",
          state ? `${state.substring(0, 16)}...` : "(missing)"
        );
        console.log("[AUTH CALLBACK] Query params - error:", error || "(none)");

        // Handle OAuth errors
        if (error) {
          console.error("[AUTH CALLBACK] OAuth error received:", error);
          return authFailure(error);
        }

        if (!code) {
          console.error("[AUTH CALLBACK] No authorization code received");
          return authFailure("No authorization code received");
        }

        const storedState = await getOAuthState();
        console.log(
          "[AUTH CALLBACK] Stored OAuth state:",
          storedState ? `${storedState.substring(0, 16)}...` : "(missing)"
        );

        // Verify state to prevent CSRF attacks
        if (!state || state !== storedState) {
          console.error("[AUTH CALLBACK] State validation failed:", {
            receivedState: state ? `${state.substring(0, 16)}...` : "(missing)",
            storedState: storedState
              ? `${storedState.substring(0, 16)}...`
              : "(missing)",
            statesMatch: state === storedState,
          });

          // If state doesn't match but we have a code, it might be a cookie issue
          // Don't redirect to error immediately - try to clear and restart auth
          if (code && !storedState) {
            console.log(
              "[AUTH CALLBACK] Cookie was lost - clearing tokens and restarting auth"
            );
            // Cookie was lost - clear everything and redirect to auth start
            await clearOnshapeTokens();
            await clearOAuthState();
            await clearOAuthRedirect();
            // One retry only — if the state cookie still does not survive the
            // round trip, retrying just rebuilds the same loop.
            if (url.searchParams.get("retry") === "1") {
              return authFailure(
                "Sign-in state cookie was not preserved. Check that cookies are enabled and that APP_URL matches the address you are using."
              );
            }
            return redirectResponse("/auth/onshape?retry=1");
          }

          return authFailure("Invalid state parameter. Please try again.");
        }

        console.log("[AUTH CALLBACK] State validation passed");

        const clientId = process.env.ONSHAPE_CLIENT_ID;
        const clientSecret = process.env.ONSHAPE_CLIENT_SECRET;
        console.log(
          "[AUTH CALLBACK] ONSHAPE_CLIENT_ID:",
          clientId ? `${clientId.substring(0, 8)}...` : "(not set)"
        );
        console.log(
          "[AUTH CALLBACK] ONSHAPE_CLIENT_SECRET:",
          clientSecret ? "***set***" : "(not set)"
        );

        // Dynamically construct redirect URI from request URL
        // Falls back to environment variable if set (for backwards compatibility)
        const redirectUri =
          process.env.ONSHAPE_REDIRECT_URI ||
          `${url.origin}/auth/onshape/callback`;

        console.log("[AUTH CALLBACK] Constructed redirectUri:", redirectUri);
        console.log(
          "[AUTH CALLBACK] Using env ONSHAPE_REDIRECT_URI:",
          !!process.env.ONSHAPE_REDIRECT_URI
        );

        if (!clientId || !clientSecret) {
          throw new Error("Missing Onshape OAuth environment variables");
        }

        try {
          console.log(
            "[AUTH CALLBACK] Exchanging authorization code for token..."
          );
          // Exchange authorization code for access token
          const tokenResponse = await exchangeCodeForToken(
            code,
            redirectUri,
            clientId,
            clientSecret
          );

          console.log("[AUTH CALLBACK] Token exchange successful");
          console.log(
            "[AUTH CALLBACK] Token expires_in:",
            tokenResponse.expires_in
          );

          // Store tokens in cookies
          const expiresAt = Date.now() + tokenResponse.expires_in * 1000;
          await setOnshapeTokens(
            tokenResponse.access_token,
            tokenResponse.refresh_token,
            expiresAt
          );

          console.log("[AUTH CALLBACK] Tokens stored in cookies");
          console.log(
            "[AUTH CALLBACK] Token expires at:",
            new Date(expiresAt).toISOString()
          );

          // Clear OAuth state after successful exchange
          await clearOAuthState();
          console.log("[AUTH CALLBACK] OAuth state cleared");

          // Get the original redirect destination
          const originalRedirect = await getOAuthRedirect();
          await clearOAuthRedirect();
          console.log(
            "[AUTH CALLBACK] Original redirect destination:",
            originalRedirect || "(none)"
          );

          // Fetch user info from Onshape API and save to database
          try {
            console.log(
              "[AUTH CALLBACK] Fetching user info from Onshape API..."
            );
            const userResponse = await onshapeApiRequest(
              tokenResponse.access_token,
              "/users/current"
            );

            if (userResponse.ok) {
              const userData = (await userResponse.json()) as {
                id: string;
                firstName?: string;
                lastName?: string;
                email?: string;
                name?: string;
              };

              console.log("[AUTH CALLBACK] User data received:", {
                id: userData.id,
                hasFirstName: !!userData.firstName,
              });

              // Save user to database (first name + last initial)
              const savedUser = await upsertUser(
                userData.id,
                userData.firstName || null,
                userData.lastName || null
              );

              if (savedUser) {
                console.log(
                  "[AUTH CALLBACK] User saved to database successfully"
                );
              } else {
                console.warn(
                  "[AUTH CALLBACK] Failed to save user to database (non-fatal)"
                );
              }
            } else {
              const errorText = await userResponse
                .text()
                .catch(() => "Unable to read error");
              console.warn(
                `[AUTH CALLBACK] Failed to fetch user info (non-fatal). Status: ${userResponse.status}, Error: ${errorText}`
              );
            }
          } catch (error) {
            // Log error but don't fail authentication
            console.error(
              "[AUTH CALLBACK] Error fetching/saving user info (non-fatal):",
              error
            );
          }

          // Redirect to the original destination now that the session cookies
          // are set — the gate reads those on the way back in. Re-sanitised
          // rather than trusted: this arrives from a cookie, and a cookie is
          // still caller-supplied input.
          const redirectUrl = new URL(
            safeRedirectPath(originalRedirect),
            resolveAppOrigin(request)
          );
          console.log(
            "[AUTH CALLBACK] Redirecting to:",
            redirectUrl.toString()
          );
          console.log("[AUTH CALLBACK] ===== Callback Complete =====");

          return redirectResponse(redirectUrl.toString());
        } catch (error) {
          console.error("[AUTH CALLBACK] Token exchange error:", error);
          await clearOnshapeTokens();
          await clearOAuthState();
          await clearOAuthRedirect();
          return authFailure("Failed to exchange authorization code");
        }
      },
    },
  },
});
