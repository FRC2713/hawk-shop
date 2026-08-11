import { createFileRoute } from "@tanstack/react-router";
import { fetchOnshapeAuthState } from "~/lib/authServerFns";

export const Route = createFileRoute("/auth/status")({
  loader: () => fetchOnshapeAuthState(),
  component: AuthStatus,
});

function AuthStatus() {
  const { isAuthenticated: onshape } = Route.useLoaderData();

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">Authentication Status</h1>

        <div className="space-y-4">
          <div className="rounded-lg border p-4">
            <h2 className="mb-2 font-semibold">Onshape</h2>
            <p className="text-muted-foreground text-sm">
              {onshape ? (
                <span className="text-green-600">✓ Authenticated</span>
              ) : (
                <span className="text-destructive">✗ Not authenticated</span>
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
