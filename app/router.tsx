import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { AppErrorComponent } from "./components/app/AppError";
import { NotFound } from "./components/app/NotFound";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    defaultErrorComponent: AppErrorComponent,
    defaultNotFoundComponent: () => <NotFound />,
    scrollRestoration: true,
  });
}
