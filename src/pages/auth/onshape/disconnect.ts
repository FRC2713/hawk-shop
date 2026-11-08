import type { APIRoute } from "astro";
import {
  clearOnshapeTokens,
  clearOAuthState,
  clearOAuthRedirect,
} from "~/lib/onshapeAuth";
export const POST: APIRoute = async ({ redirect }) => {
  await clearOnshapeTokens();
  await clearOAuthState();
  await clearOAuthRedirect();
  return redirect("/onshape", 303);
};
