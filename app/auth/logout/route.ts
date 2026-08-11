import { NextResponse } from "next/server";
import { clearOAuthState, clearOnshapeTokens } from "~/lib/onshapeAuth";

export async function GET(request: Request) {
  // Clear all Onshape auth cookies
  await clearOnshapeTokens();
  await clearOAuthState();

  const url = new URL(request.url);
  return NextResponse.redirect(new URL("/", url.origin));
}
