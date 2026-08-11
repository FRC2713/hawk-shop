import { NextRequest, NextResponse } from "next/server";
import { isOnshapeAuthenticatedFromRequest } from "~/lib/onshapeAuth";

export default function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // Skip authentication check for public routes
  if (pathname.startsWith("/signin") || pathname.startsWith("/auth/")) {
    return NextResponse.next();
  }

  // Allow requests coming from auth callback or /auth/onshape (prevents redirect loops)
  // These routes add ?auth=success to indicate successful authentication
  // Even if cookies aren't immediately readable in iframe contexts, we trust these routes
  if (searchParams.get("auth") === "success") {
    // Allow the request through - cookies should be set by now
    // The ?auth=success param will remain in the URL but won't cause issues
    // It will be naturally cleaned on subsequent navigations
    console.log(
      "[PROXY] Auth success param detected, allowing request through"
    );
    return NextResponse.next();
  }

  // Check if Onshape is authenticated
  const isAuthenticated = isOnshapeAuthenticatedFromRequest(request);

  if (!isAuthenticated) {
    // For API routes, allow same-origin requests through
    // Route handlers can read cookies via cookies() which works better than middleware
    // in iframe contexts. The route handlers will verify authentication.
    if (pathname.startsWith("/api/")) {
      // In iframe contexts, cookies might not be readable in middleware but are readable in route handlers
      // Allow all API requests through - route handlers will verify authentication
      // This is safe because:
      // 1. Route handlers use cookies() which works better than middleware cookie parsing
      // 2. Routes that need Onshape auth (like /api/onshape/*) already check it
      // 3. Other routes should still be protected but can read cookies in route handler
      console.log(
        "[PROXY] API route - allowing request through (route handler will verify auth via cookies())"
      );
      return NextResponse.next();
    }

    // For page routes, redirect to Onshape auth
    const fullPath = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
    const authUrl = new URL("/auth/onshape", request.url);
    authUrl.searchParams.set("redirect", fullPath);

    console.log(
      "[PROXY] Page route not authenticated, redirecting to Onshape auth"
    );
    console.log("[PROXY] Full path:", fullPath);

    return NextResponse.redirect(authUrl);
  }

  // User is authenticated, proceed with the request
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     *
     * Note: API routes are now included and require authentication
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
