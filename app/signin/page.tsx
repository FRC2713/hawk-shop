import { redirect } from "next/navigation";
import { isOnshapeAuthenticated } from "~/lib/onshapeAuth";
import { SignInClient } from "./signin-client";

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  // Check for redirect in URL params, or default
  const queryParams = await searchParams;
  const redirectTo = queryParams.redirect || "/mfg/kanban";

  console.log("[SIGNIN] ===== SignIn Page =====");
  console.log("[SIGNIN] redirectTo:", redirectTo);
  console.log("[SIGNIN] NODE_ENV:", process.env.NODE_ENV);

  // Check authentication status
  const onshapeAuth = await isOnshapeAuthenticated();

  console.log("[SIGNIN] onshapeAuth:", onshapeAuth);

  // If authenticated, redirect to the intended destination
  if (onshapeAuth) {
    console.log("[SIGNIN] Onshape authenticated, redirecting to:", redirectTo);
    return redirect(redirectTo);
  }

  console.log("[SIGNIN] Not authenticated, showing signin form");
  return <SignInClient onshapeAuth={onshapeAuth} redirectTo={redirectTo} />;
}
