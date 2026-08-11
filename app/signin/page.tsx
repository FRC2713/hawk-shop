import { redirect } from "next/navigation";
import { isOnshapeAuthenticated } from "~/lib/onshapeAuth";
import { SignInClient } from "./signin-client";

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; error?: string }>;
}) {
  // Check for redirect in URL params, or default
  const queryParams = await searchParams;
  const redirectTo = queryParams.redirect || "/kanban";
  const error = queryParams.error;

  console.log("[SIGNIN] ===== SignIn Page =====");
  console.log("[SIGNIN] redirectTo:", redirectTo);
  console.log("[SIGNIN] NODE_ENV:", process.env.NODE_ENV);

  // Check authentication status
  const onshapeAuth = await isOnshapeAuthenticated();

  console.log("[SIGNIN] onshapeAuth:", onshapeAuth);

  // If authenticated, redirect to the intended destination. An error in the URL
  // means we just bounced off a failed sign-in, so show it rather than looping
  // the user straight back into the app.
  if (onshapeAuth && !error) {
    console.log("[SIGNIN] Onshape authenticated, redirecting to:", redirectTo);
    return redirect(redirectTo);
  }

  console.log("[SIGNIN] Not authenticated, showing signin form");
  return (
    <SignInClient
      onshapeAuth={onshapeAuth}
      redirectTo={redirectTo}
      error={error}
    />
  );
}
