import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { DashboardClient } from "~/components/app/dashboard-client";
import { getCurrentOnshapeUser } from "~/lib/onshapeApi/client";

/**
 * Welcome-message lookup. Read-only — no token refresh, matching the old server
 * component, so an expired token just means no greeting rather than an error.
 */
const fetchCurrentUser = createServerFn().handler(async () => {
  const user = await getCurrentOnshapeUser();
  return { name: user?.name ?? null };
});

export const Route = createFileRoute("/_main/")({
  head: () => ({
    meta: [
      { title: "Hawk Shop" },
      {
        name: "description",
        content: "Shop dashboard — manufacturing, equipment, and processes",
      },
    ],
  }),
  loader: () => fetchCurrentUser(),
  component: Home,
});

function Home() {
  const currentUser = Route.useLoaderData();

  return <DashboardClient userName={currentUser.name} />;
}
