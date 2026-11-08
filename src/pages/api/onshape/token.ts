import type { APIRoute } from "astro";
import { getValidOnshapeToken } from "~/lib/tokenRefresh";

/**
 * API route to get the current Onshape access token
 * This allows client components to get tokens without directly accessing cookies
 */
export const GET: APIRoute = async () => {
  try {
    const token = await getValidOnshapeToken();

    if (!token) {
      return Response.json(
        { error: "Connect Onshape to use CAD features." },
        { status: 409 }
      );
    }

    return Response.json({ accessToken: token });
  } catch (error) {
    console.error("[API] Error getting Onshape token:", error);
    return Response.json({ error: "Failed to get token" }, { status: 500 });
  }
};
