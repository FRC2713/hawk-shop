"use client";

import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Box, CheckCircle2 } from "lucide-react";

export function SignInClient({
  onshapeAuth,
  redirectTo,
}: {
  onshapeAuth: boolean;
  redirectTo: string;
}) {
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
