import { getCurrentOnshapeUser } from "~/lib/onshapeApi/client";
import type { Metadata } from "next";
import Link from "next/link";
import { KanbanSquare, Wrench, ArrowRight, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

export const metadata: Metadata = {
  title: "RHR Manufacturing",
  description: "Manufacturing workflow management",
};

export default async function Home() {
  // Get current user for welcome message (read-only, no token refresh during render)
  const currentUser = await getCurrentOnshapeUser();

  return (
    <main className="from-background to-muted/20 min-h-screen bg-gradient-to-b">
      <div className="container mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Hero Section */}
        <div className="mb-12 text-center">
          <div className="mb-4 flex items-center justify-center gap-2">
            <Sparkles className="text-primary size-8" />
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              RHR Manufacturing
            </h1>
            <Sparkles className="text-primary size-8" />
          </div>
          {currentUser && (
            <p className="text-foreground mb-4 text-xl sm:text-2xl">
              Welcome back,{" "}
              <span className="text-primary font-semibold">
                {currentUser.name}
              </span>
              !
            </p>
          )}
          <p className="text-muted-foreground mx-auto max-w-2xl text-lg sm:text-xl">
            Streamline your FRC team's manufacturing workflow. Track parts,
            manage equipment, and keep your build season organized.
          </p>
        </div>

        {/* Feature Cards Grid */}
        <div className="grid gap-6 sm:grid-cols-1 md:grid-cols-2 lg:gap-8">
          <Link href="/kanban" className="group">
            <Card className="hover:border-primary hover:shadow-primary/20 h-full transition-all duration-300 group-hover:scale-[1.02] hover:shadow-lg">
              <CardHeader className="pb-3">
                <div className="mb-4 flex items-center gap-4">
                  <div className="bg-primary/10 group-hover:bg-primary/20 rounded-lg p-3 transition-colors">
                    <KanbanSquare className="text-primary size-8" />
                  </div>
                  <CardTitle className="text-2xl">Kanban Board</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-muted-foreground">
                  Visualize your part manufacturing pipeline. Move parts through
                  stages from design to completion.
                </p>
                <div className="text-primary flex items-center gap-2 text-sm font-medium">
                  Open Kanban Board
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/equipment" className="group">
            <Card className="hover:border-primary hover:shadow-primary/20 h-full transition-all duration-300 group-hover:scale-[1.02] hover:shadow-lg">
              <CardHeader className="pb-3">
                <div className="mb-4 flex items-center gap-4">
                  <div className="bg-primary/10 group-hover:bg-primary/20 rounded-lg p-3 transition-colors">
                    <Wrench className="text-primary size-8" />
                  </div>
                  <CardTitle className="text-2xl">Equipment</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-muted-foreground">
                  Monitor tool usage, schedule maintenance, and ensure your shop
                  equipment is always ready.
                </p>
                <div className="text-primary flex items-center gap-2 text-sm font-medium">
                  View Equipment
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </main>
  );
}
