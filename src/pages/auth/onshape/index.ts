import type { APIRoute } from "astro";
import { randomBytes } from "node:crypto";
import { getAuthorizationUrl } from "~/lib/onshapeApi/auth";
import { setOAuthState, setOAuthRedirect } from "~/lib/onshapeAuth";
import { refreshOnshapeTokenIfNeeded } from "~/lib/tokenRefresh";
import { safeRedirectPath } from "~/lib/safeRedirect";

/** Connect CAD access for an already authenticated Suite member. */
export const GET: APIRoute = async ({ request, redirect }) => {
  const url = new URL(request.url);
  const destination = safeRedirectPath(
    url.searchParams.get("redirect") || "/onshape"
  );
  if (await refreshOnshapeTokenIfNeeded()) return redirect(destination);
  const clientId = process.env.ONSHAPE_CLIENT_ID;
  if (!clientId || !process.env.ONSHAPE_CLIENT_SECRET)
    return redirect(
      "/onshape?error=" +
        encodeURIComponent("The Onshape integration is not configured.")
    );
  const redirectUri =
    process.env.ONSHAPE_REDIRECT_URI ||
    `${process.env.APP_URL || url.origin}/auth/onshape/callback`;
  const state = randomBytes(32).toString("hex");
  await setOAuthState(state);
  await setOAuthRedirect(destination);
  return redirect(getAuthorizationUrl(redirectUri, clientId, state));
};
