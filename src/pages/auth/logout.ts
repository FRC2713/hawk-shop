import type { APIRoute } from "astro";
import {
  clearOAuthState,
  clearOAuthRedirect,
  clearOnshapeTokens,
} from "~/lib/onshapeAuth";
import { suiteUrl } from "~/server/suite-identity";
export const GET: APIRoute = async ({ redirect }) => {
  await clearOnshapeTokens();
  await clearOAuthState();
  await clearOAuthRedirect();
  return redirect(suiteUrl("auth/logout") || "/signin");
};
