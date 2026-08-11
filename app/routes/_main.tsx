import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { MainLayoutClient } from "~/components/app/MainLayout";
import { fetchOnshapeAuthState } from "~/lib/authServerFns";

/**
 * The chrome'd half of the app — home, /kanban, /equipment. This is the
 * pathless-layout equivalent of Next's `app/(main)/layout.tsx` route group: it
 * wraps its children without contributing a URL segment.
 *
 * The request middleware in `app/start.ts` only sees document requests, so it
 * gates the first page load and nothing after it. Every navigation within the
 * app is client-side, which is why this loader re-checks and bounces into the
 * OAuth flow itself. `reloadDocument` because `/auth/onshape` is a server
 * handler rather than a route in the tree.
 */
export const Route = createFileRoute("/_main")({
  loader: async ({ location }) => {
    const { isAuthenticated } = await fetchOnshapeAuthState();

    if (!isAuthenticated) {
      throw redirect({
        href: `/auth/onshape?redirect=${encodeURIComponent(location.href)}`,
        reloadDocument: true,
      });
    }

    return { isAuthenticated };
  },
  component: MainLayout,
});

function MainLayout() {
  const { isAuthenticated } = Route.useLoaderData();

  return (
    <MainLayoutClient
      isAuthenticated={isAuthenticated}
      onshapeAuth={isAuthenticated}
    >
      <Outlet />
    </MainLayoutClient>
  );
}
