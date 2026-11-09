import type { APIRoute } from "astro";
import { suiteUrl } from "~/server/suite-identity";
export const GET: APIRoute = ({ redirect }) =>
  redirect(suiteUrl("auth/logout") || "/signin");
