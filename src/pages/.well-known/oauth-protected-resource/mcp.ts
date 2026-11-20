import type { APIRoute } from "astro";
import { protectedResourceMetadata } from "~/server/oauth/handlers";
export const prerender = false;
export const GET: APIRoute = () => protectedResourceMetadata();
