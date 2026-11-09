import { Component, type ReactNode } from "react";
import { Providers } from "~/providers";
import { Toaster } from "~/components/ui/sonner";
import { KanbanRealtimeSubscriber } from "~/components/kanban/KanbanRealtimeSubscriber";
import { ErrorDisplay } from "~/components/mfg/ErrorDisplay";
import { identifyClientError, getErrorId } from "~/lib/api/client";

class WorkflowBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; error: Error | null }
> {
  state = { failed: false, error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { failed: true, error: identifyClientError(error) };
  }
  componentDidCatch(error: Error) {
    console.error(`[WORKFLOW] errorId=${getErrorId(error)}`, error);
  }
  render() {
    if (this.state.failed)
      return (
        <section role="alert" className="p-6">
          <h1>Unable to display this workflow</h1>
          <p>Your saved work is still available.</p>
          {this.state.error && <ErrorDisplay error={this.state.error} />}
          <button
            className="mt-4 underline"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </section>
      );
    return this.props.children;
  }
}

/** One React root owns each interactive workflow, its cache and event stream. */
export function Workflow({ children }: { children: ReactNode }) {
  return (
    <WorkflowBoundary>
      <Providers>
        <KanbanRealtimeSubscriber />
        {children}
        <Toaster />
      </Providers>
    </WorkflowBoundary>
  );
}
