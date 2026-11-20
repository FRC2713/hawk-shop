import type { APIRoute } from "astro";
import { authorizationServerMetadata } from "~/server/oauth/handlers";
export const prerender = false;
export const GET: APIRoute = () => authorizationServerMetadata();
