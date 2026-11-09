import type { APIRoute } from "astro";
import { embeddedCookie, redeemEmbeddedCode } from "~/server/embedded-auth";

// Middleware permits exactly this POST without identity, after its origin check.
export const POST: APIRoute = async ({ request }) => {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return new Response(null, { status: 415 });
  const text = await request.text();
  if (text.length > 1024) return new Response(null, { status: 413 });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const token = redeemEmbeddedCode(body?.code, body?.verifier);
  if (!token) return new Response(null, { status: 401 });
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": embeddedCookie(token) },
  });
};
