import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getAuthorizationUrl } from "~/lib/onshapeApi/auth";
import {
  getOnshapeToken,
  setOAuthState,
  setOAuthRedirect,
} from "~/lib/onshapeAuth";
import { resolveAppOrigin } from "~/lib/appOrigin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirectTo = url.searchParams.get("redirect") || "/";

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

  // Check if already authenticated
  const accessToken = await getOnshapeToken();
  console.log("[AUTH ONSHAPE] Already authenticated:", !!accessToken);
  if (accessToken) {
    // Prevent redirect loops - don't redirect to auth routes
    const safeRedirect =
      redirectTo.startsWith("/auth/") || redirectTo.startsWith("/signin")
        ? "/"
        : redirectTo;
    const redirectUrl = new URL(safeRedirect, resolveAppOrigin(request));
    // Add auth=success param to bypass middleware check (prevents redirect loops in iframe contexts)
    redirectUrl.searchParams.set("auth", "success");
    console.log(
      "[AUTH ONSHAPE] Redirecting authenticated user to:",
      redirectUrl.toString()
    );
    return NextResponse.redirect(redirectUrl);
  }

  const clientId = process.env.ONSHAPE_CLIENT_ID;
  console.log(
    "[AUTH ONSHAPE] ONSHAPE_CLIENT_ID:",
    clientId ? `${clientId.substring(0, 8)}...` : "(not set)"
  );

  // Dynamically construct redirect URI from request URL
  // Falls back to environment variable if set (for backwards compatibility)
  const redirectUri =
    process.env.ONSHAPE_REDIRECT_URI || `${url.origin}/auth/onshape/callback`;

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
  return NextResponse.redirect(authUrl);
}
