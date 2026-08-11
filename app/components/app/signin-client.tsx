import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Box, CheckCircle2, TriangleAlert } from "lucide-react";

/**
 * Extra guidance for OAuth failures whose raw code says nothing actionable to
 * someone setting up a self-hosted install.
 */
const ERROR_HINTS: Record<string, string> = {
  invalid_scope:
    "Onshape rejected the requested permissions. Make sure the scopes enabled on your Onshape OAuth application match the ONSHAPE_SCOPE setting.",
  invalid_client:
    "Onshape did not recognize the client credentials. Check ONSHAPE_CLIENT_ID and ONSHAPE_CLIENT_SECRET.",
  redirect_uri_mismatch:
    "The redirect URL does not match the one registered on your Onshape OAuth application. Both must be identical, including scheme and port.",
  access_denied: "The sign-in request was declined in Onshape.",
};

export function SignInClient({
  onshapeAuth,
  redirectTo,
  error,
}: {
  onshapeAuth: boolean;
  redirectTo: string;
  error?: string;
}) {
  const hint = error ? ERROR_HINTS[error] : undefined;
  const handleOnshapeAuth = () => {
    // Redirect to Onshape auth - will return to /signin after
    window.location.href = `/auth/onshape?redirect=${encodeURIComponent("/signin")}`;
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4 dark:from-slate-950 dark:to-slate-900">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="mb-4 flex items-center justify-center">
            <Box className="text-primary h-12 w-12" />
          </div>
          <CardTitle className="text-center text-2xl">
            Sign In Required
          </CardTitle>
          <CardDescription className="text-center">
            Connect your Onshape account to continue
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div
              role="alert"
              className="flex gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/50"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-500" />
              <div className="space-y-1">
                <p className="font-medium text-red-900 dark:text-red-200">
                  Sign-in failed: {error}
                </p>
                {hint && (
                  <p className="text-red-800 dark:text-red-300">{hint}</p>
                )}
              </div>
            </div>
          )}

          {/* Onshape Authentication */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Onshape</h3>
              {onshapeAuth && (
                <div className="flex items-center gap-1 text-green-600 dark:text-green-500">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="text-xs">Connected</span>
                </div>
              )}
            </div>
            <Button
              onClick={handleOnshapeAuth}
              variant={onshapeAuth ? "outline" : "default"}
              className="w-full"
              disabled={onshapeAuth}
            >
              {onshapeAuth ? "Onshape Connected" : "Connect Onshape"}
            </Button>
          </div>

          {/* Status Message */}
          {onshapeAuth && (
            <div className="pt-4 text-center">
              <p className="text-muted-foreground text-sm">
                Onshape connected! Redirecting...
              </p>
            </div>
          )}

          {!onshapeAuth && (
            <div className="pt-4 text-center">
              <p className="text-muted-foreground text-sm">
                You need to connect your Onshape account to access manufacturing
                parts
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
