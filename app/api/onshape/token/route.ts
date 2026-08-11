import { NextResponse } from "next/server";
import { getValidOnshapeToken } from "~/lib/tokenRefresh";

/**
 * API route to get the current Onshape access token
 * This allows client components to get tokens without directly accessing cookies
 */
export async function GET() {
  try {
    const token = await getValidOnshapeToken();

    if (!token) {
      return NextResponse.json(
        { error: "Not authenticated with Onshape" },
        { status: 401 }
      );
    }

    return NextResponse.json({ accessToken: token });
  } catch (error) {
    console.error("[API] Error getting Onshape token:", error);
    return NextResponse.json({ error: "Failed to get token" }, { status: 500 });
  }
}
