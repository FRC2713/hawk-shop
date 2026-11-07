import "@tanstack/react-start/server-only";
// Requiring a custom header blocks simple cross-site requests even with iframe cookies.
// Compare the browser Origin with deployment origin, never a forwarded host header.
export function rejectSlackCrossOrigin(request: Request) {
  const expected = new URL(process.env.APP_URL || request.url).origin;
  if (
    request.headers.get("X-Hawk-Shop-Slack") !== "1" ||
    request.headers.get("Origin") !== expected ||
    !request.headers.get("Content-Type")?.startsWith("application/json")
  ) {
    return Response.json(
      { error: "Use the Hawk Shop Slack settings page for this operation." },
      { status: 403 }
    );
  }
  return null;
}
