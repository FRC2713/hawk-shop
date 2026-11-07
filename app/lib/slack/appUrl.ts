import "@tanstack/react-start/server-only";
import { SlackError } from "./client";

export function slackAppBaseUrl(): URL {
  try {
    const url = new URL(process.env.APP_URL || "");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw Error();
    return url;
  } catch {
    throw new SlackError("app_url_invalid");
  }
}
