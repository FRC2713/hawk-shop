import type { APIRoute } from "astro";
import { token } from "~/server/oauth/handlers";
export const prerender = false;
export const POST: APIRoute = ({ request }) => token(request);
