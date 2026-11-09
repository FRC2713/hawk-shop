import type { APIRoute } from "astro";
import { suiteUrl } from "~/server/suite-identity";
import { embeddedCookie } from "~/server/embedded-auth";
export const GET: APIRoute = ({ redirect }) => {
  const response = redirect(suiteUrl("auth/logout") || "/signin");
  response.headers.append("Set-Cookie", embeddedCookie("", 0));
  return response;
};
