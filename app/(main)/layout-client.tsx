"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Home, User, LogIn, LogOut, Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { KanbanRealtimeSubscriber } from "~/components/kanban/KanbanRealtimeSubscriber";

function getBreadcrumbs(pathname: string) {
  const paths = pathname.split("/").filter(Boolean);
  const breadcrumbs: Array<{ label: string; href: string }> = [];

  // Route label mapping for better display names
  const routeLabels: Record<string, string> = {
    mfg: "MFG",
    tasks: "Tasks",
    projects: "Projects",
  };

  // If we're at home, just return home breadcrumb
  if (pathname === "/") {
    return [{ label: "Home", href: "/" }];
  }

  // Always start with Home
  breadcrumbs.push({ label: "Home", href: "/" });

  // Build breadcrumbs from path segments
  let currentPath = "";
  paths.forEach((segment) => {
    currentPath += `/${segment}`;

    // Use mapped label if available, otherwise format the segment
    const label =
      routeLabels[segment] ||
      segment
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");

    breadcrumbs.push({ label, href: currentPath });
  });

  return breadcrumbs;
}

export function MainLayoutClient({
  children,
  isAuthenticated,
  onshapeAuth,
}: {
  children: React.ReactNode;
  isAuthenticated: boolean;
  onshapeAuth: boolean;
}) {
  const pathname = usePathname();
  const breadcrumbs = getBreadcrumbs(pathname);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch by only showing theme switcher after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <KanbanRealtimeSubscriber />
      {/* Breadcrumbs */}
      <div className="bg-background/95 supports-[backdrop-filter]:bg-background/60 border-b backdrop-blur">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1;
                const isHome = crumb.label === "Home";
                return (
                  <div key={crumb.href} className="flex items-center">
                    <BreadcrumbItem>
                      {isLast ? (
                        <BreadcrumbPage>
                          {isHome ? (
                            <span className="flex items-center gap-1.5">
                              <Home className="h-4 w-4" />
                              {crumb.label}
                            </span>
                          ) : (
                            crumb.label
                          )}
                        </BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink asChild>
                          <Link href={crumb.href}>
                            {isHome ? (
                              <span className="flex items-center gap-1.5">
                                <Home className="h-4 w-4" />
                                {crumb.label}
                              </span>
                            ) : (
                              crumb.label
                            )}
                          </Link>
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                    {!isLast && <BreadcrumbSeparator />}
                  </div>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex items-center gap-2">
            {/* User Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <User className="h-4 w-4" />
                  <span className="sr-only">User menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Theme</DropdownMenuLabel>
                {mounted && (
                  <>
                    <DropdownMenuItem
                      onClick={() => setTheme("light")}
                      className="flex items-center"
                    >
                      <Sun className="mr-2 h-4 w-4" />
                      <span>Light</span>
                      {theme === "light" && (
                        <span className="ml-auto text-xs">✓</span>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setTheme("dark")}
                      className="flex items-center"
                    >
                      <Moon className="mr-2 h-4 w-4" />
                      <span>Dark</span>
                      {theme === "dark" && (
                        <span className="ml-auto text-xs">✓</span>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setTheme("system")}
                      className="flex items-center"
                    >
                      <Monitor className="mr-2 h-4 w-4" />
                      <span>System</span>
                      {theme === "system" && (
                        <span className="ml-auto text-xs">✓</span>
                      )}
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Authentication</DropdownMenuLabel>
                <DropdownMenuSeparator />

                {isAuthenticated ? (
                  <>
                    <div className="text-muted-foreground px-2 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-green-500" />
                        <span>Onshape Connected</span>
                      </div>
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/auth/logout" className="flex items-center">
                        <LogOut className="mr-2 h-4 w-4" />
                        <span>Sign Out</span>
                      </Link>
                    </DropdownMenuItem>
                  </>
                ) : (
                  <>
                    {onshapeAuth && (
                      <div className="text-muted-foreground px-2 py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-green-500" />
                          <span>Onshape Connected</span>
                        </div>
                      </div>
                    )}
                    {onshapeAuth && <DropdownMenuSeparator />}
                    <DropdownMenuItem asChild>
                      <Link href="/signin" className="flex items-center">
                        <LogIn className="mr-2 h-4 w-4" />
                        <span>Sign In</span>
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Route content */}
      <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
