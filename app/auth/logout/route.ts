import { NextResponse } from "next/server";
import { clearOAuthState, clearOnshapeTokens } from "~/lib/onshapeAuth";
import { resolveAppOrigin } from "~/lib/appOrigin";

export async function GET(request: Request) {
  // Clear all Onshape auth cookies
  await clearOnshapeTokens();
  await clearOAuthState();

  return NextResponse.redirect(new URL("/", resolveAppOrigin(request)));
}
