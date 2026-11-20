import type { APIRoute } from "astro";
import { revoke } from "~/server/oauth/handlers";
export const prerender = false;
export const POST: APIRoute = ({ request }) => revoke(request);
