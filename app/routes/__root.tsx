/// <reference types="vite/client" />
import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import type * as React from "react";
import { Providers } from "~/providers";
import { Toaster } from "~/components/ui/sonner";
import { AppErrorComponent } from "~/components/app/AppError";
import { NotFound } from "~/components/app/NotFound";
import appCss from "~/app.css?url";

export const Route = createRootRoute({
  // The whole app sits behind Onshape OAuth and runs on a shop LAN, so there is
  // no SEO or cold-cache case for server-rendering page content — every screen
  // re-fetches from `/api/*` on the client anyway. Rendering only this shell on
  // the server keeps the request middleware auth gate (which is what makes the
  // OAuth redirect work) while making loaders and components browser-only, so
  // there is one place data comes from instead of two.
  ssr: false,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Hawk Shop" },
      {
        name: "description",
        content: "Shop management for a FIRST Robotics team",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  errorComponent: AppErrorComponent,
  notFoundComponent: () => <NotFound />,
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <head>
        <HeadContent />
      </head>
      <body className="h-full">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <Providers>
            {children}
            <Toaster />
          </Providers>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
