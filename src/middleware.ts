import { defineMiddleware } from "astro:middleware";
import { requestContext } from "./server/request-context";
import { suiteIdentity, suiteSettings } from "./server/suite-identity";

export const onRequest = defineMiddleware(async (context, next) => {
  if (import.meta.env.DEV) {
    const { startSlackWorker } = await import("./lib/slack/worker");
    startSlackWorker();
  }
  const path = context.url.pathname.replace(/\/$/, "") || "/";
  if (
    (path === "/api/health" || path === "/health") &&
    ["GET", "HEAD"].includes(context.request.method)
  )
    return next();
  if (
    path.startsWith("/_astro/") ||
    path.startsWith("/brand/") ||
    path === "/favicon.svg"
  )
    return next();
  return requestContext.run(context, async () => {
    try {
      context.locals.identity = suiteIdentity(context.request);
    } catch {
      return Response.json(
        { error: "Hawk Suite authentication is not configured correctly." },
        { status: 503 }
      );
    }
    if (path === "/signin") return next();
    if (!context.locals.identity) {
      const configured = suiteSettings().HAWK_SUITE_TRUST_PROXY === "true";
      if (path.startsWith("/api/") || path.startsWith("/_actions/")) {
        return Response.json(
          {
            error: configured
              ? "Sign in with Hawk Suite to continue."
              : "Hawk Suite authentication is not configured.",
          },
          {
            status: configured ? 401 : 503,
            headers: { "Cache-Control": "no-store" },
          }
        );
      }
      const destination = context.url.pathname + context.url.search;
      // Slack and Suite use top-level cookies. An Onshape iframe can only
      // offer a top-level continuation, never a second authentication bypass.
      if (
        path === "/onshape_connector" &&
        context.request.headers.get("sec-fetch-dest") === "iframe"
      ) {
        return new Response(
          `<html lang="en"><meta name="viewport" content="width=device-width"><title>Open Hawk Shop</title><body><p>Open Hawk Shop to sign in with Hawk Suite and release these parts.</p><a target="_top" href="/signin?redirect=${encodeURIComponent(destination)}">Open Hawk Shop</a></body></html>`,
          {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            },
          }
        );
      }
      return context.redirect(
        `/signin?redirect=${encodeURIComponent(destination)}`
      );
    }
    if (context.request.method === "GET" && !path.startsWith("/api/")) {
      const { upsertUser } = await import("./server/db/users");
      const identity = context.locals.identity;
      const parts = identity.name?.split(/\s+/) ?? [];
      await upsertUser(
        identity.subject,
        parts[0] || "Suite member",
        parts.slice(1).join(" ") || undefined,
        identity.email ?? null
      );
    }
    // Require same-origin writes for JSON, multipart, uploads, and actions.
    if (!["GET", "HEAD", "OPTIONS"].includes(context.request.method)) {
      const origin = context.request.headers.get("origin");
      const expected = process.env.APP_URL
        ? new URL(process.env.APP_URL).origin
        : context.url.origin;
      if (origin !== expected)
        return Response.json(
          { error: "Request origin is not allowed." },
          { status: 403 }
        );
    }
    const response = await next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  });
});
