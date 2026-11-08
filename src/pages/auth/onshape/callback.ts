import type { APIRoute } from "astro";
import { exchangeCodeForToken } from "~/lib/onshapeApi/auth";
import {
  clearOAuthRedirect,
  clearOAuthState,
  clearOnshapeTokens,
  getOAuthRedirect,
  getOAuthState,
  setOnshapeTokens,
} from "~/lib/onshapeAuth";
import { safeRedirectPath } from "~/lib/safeRedirect";

export const GET: APIRoute = async ({ request, redirect }) => {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const storedState = await getOAuthState();
  const destination = safeRedirectPath(await getOAuthRedirect());
  await clearOAuthState();
  await clearOAuthRedirect();
  const failure = (message: string) =>
    redirect("/onshape?error=" + encodeURIComponent(message));
  if (!state || !storedState || state !== storedState)
    return failure("The Onshape connection request expired. Please try again.");
  if (url.searchParams.has("error"))
    return failure("Onshape did not approve the connection.");
  const code = url.searchParams.get("code");
  const clientId = process.env.ONSHAPE_CLIENT_ID;
  const clientSecret = process.env.ONSHAPE_CLIENT_SECRET;
  if (!code || !clientId || !clientSecret)
    return failure("The Onshape connection could not be completed.");
  try {
    const redirectUri =
      process.env.ONSHAPE_REDIRECT_URI ||
      `${process.env.APP_URL || url.origin}/auth/onshape/callback`;
    const tokens = await exchangeCodeForToken(
      code,
      redirectUri,
      clientId,
      clientSecret
    );
    await setOnshapeTokens(
      tokens.access_token,
      tokens.refresh_token,
      Date.now() + tokens.expires_in * 1000
    );
    return redirect(destination);
  } catch {
    await clearOnshapeTokens();
    return failure("Onshape could not be connected. Please try again.");
  }
};
