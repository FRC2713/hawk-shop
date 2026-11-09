import type { APIRoute } from "astro";

// Both gateway and middleware require a verified Suite identity.
export const GET: APIRoute = () => new Response(null, { status: 204 });
