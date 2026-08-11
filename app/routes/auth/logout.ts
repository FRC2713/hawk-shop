import { createFileRoute } from "@tanstack/react-router";
import { clearOAuthState, clearOnshapeTokens } from "~/lib/onshapeAuth";
import { resolveAppOrigin } from "~/lib/appOrigin";
import { redirectResponse } from "~/lib/httpRedirect";

export const Route = createFileRoute("/auth/logout")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Clear all Onshape auth cookies
        await clearOnshapeTokens();
        await clearOAuthState();

        return redirectResponse(
          new URL("/", resolveAppOrigin(request)).toString()
        );
      },
    },
  },
});
