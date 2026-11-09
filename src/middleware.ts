import { defineMiddleware } from "astro:middleware";
import { requestContext } from "./server/request-context";
import { suiteIdentity, suiteSettings } from "./server/suite-identity";
import { ONSHAPE_WEBHOOK_PATH } from "./server/onshape-webhook";

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
  // Onshape cannot carry Suite identity. The route checks its own secret,
  // answers empty bodies and only clears cache. Exact path and method only:
  // no trailing slash, no subpath, no other verb.
  if (
    context.url.pathname === ONSHAPE_WEBHOOK_PATH &&
    context.request.method === "POST"
  ) {
    const response = await next();
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
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
    const isExchange =
      context.url.pathname === "/auth/embed/exchange" &&
      context.request.method === "POST";
    // Authenticate ordinary requests first; the proof-based exchange must
    // enforce the same origin requirement before it can set any cookie.
    if (
      (context.locals.identity || isExchange) &&
      !["GET", "HEAD", "OPTIONS"].includes(context.request.method)
    ) {
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
    // The exchange proves possession of a one-use code and its iframe verifier.
    // It grants no identity itself; Caddy validates the resulting Suite token.
    if (isExchange) {
      const response = await next();
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
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
      // Anonymous embedded entry renders only the connection UI. Data remains
      // gated, including the API requests the parts island would make.
      if (
        path === "/onshape_connector" &&
        ["GET", "HEAD"].includes(context.request.method) &&
        context.request.headers.get("sec-fetch-dest") === "iframe"
      ) {
        const response = await next();
        response.headers.set("Cache-Control", "no-store");
        return response;
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
    const response = await next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  });
});
