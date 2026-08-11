import { createFileRoute, redirect } from "@tanstack/react-router";
import { SignInClient } from "~/components/app/signin-client";
import { fetchOnshapeAuthState } from "~/lib/authServerFns";

type SignInSearch = {
  redirect?: string;
  error?: string;
};

export const Route = createFileRoute("/signin")({
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const redirectTo = deps.redirect || "/kanban";
    const error = deps.error;

    console.log("[SIGNIN] ===== SignIn Page =====");
    console.log("[SIGNIN] redirectTo:", redirectTo);

    const { isAuthenticated } = await fetchOnshapeAuthState();

    console.log("[SIGNIN] onshapeAuth:", isAuthenticated);

    // If authenticated, redirect to the intended destination. An error in the
    // URL means we just bounced off a failed sign-in, so show it rather than
    // looping the user straight back into the app.
    if (isAuthenticated && !error) {
      console.log(
        "[SIGNIN] Onshape authenticated, redirecting to:",
        redirectTo
      );
      throw redirect({ href: redirectTo });
    }

    console.log("[SIGNIN] Not authenticated, showing signin form");
    return { onshapeAuth: isAuthenticated, redirectTo, error };
  },
  component: SignInPage,
});

function SignInPage() {
  const { onshapeAuth, redirectTo, error } = Route.useLoaderData();

  return (
    <SignInClient
      onshapeAuth={onshapeAuth}
      redirectTo={redirectTo}
      error={error}
    />
  );
}
