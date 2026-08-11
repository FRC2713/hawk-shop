"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "~/components/ui/button";

interface KanbanBoardErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface KanbanBoardErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class KanbanBoardErrorBoundary extends Component<
  KanbanBoardErrorBoundaryProps,
  KanbanBoardErrorBoundaryState
> {
  constructor(props: KanbanBoardErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): KanbanBoardErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[KanbanBoard] Error caught by boundary:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex h-full flex-col items-center justify-center p-8">
          <div className="bg-card border-destructive/20 flex w-full max-w-md flex-col items-center rounded-2xl border-2 p-8 text-center shadow-sm">
            <div className="bg-destructive/10 mb-4 rounded-full p-4">
              <AlertTriangle className="text-destructive size-8" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">Something went wrong</h3>
            <p className="text-muted-foreground mb-6 text-sm">
              {this.state.error?.message ||
                "An unexpected error occurred while loading the kanban board."}
            </p>
            <div className="flex gap-3">
              <Button onClick={this.handleReset} variant="outline">
                Try again
              </Button>
              <Button
                onClick={() => window.location.reload()}
                variant="default"
              >
                Reload page
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
