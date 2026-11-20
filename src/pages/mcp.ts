import type { APIRoute } from "astro";
import { handleMcp } from "~/server/mcp/server";

export const prerender = false;
export const ALL: APIRoute = ({ request }) => handleMcp(request);
