import type { APIRoute } from "astro";
import { register } from "~/server/oauth/handlers";
export const prerender = false;
export const POST: APIRoute = ({ request }) => register(request);
