import { Component, type ReactNode } from "react";
import { Providers } from "~/providers";
import { Toaster } from "~/components/ui/sonner";
import { KanbanRealtimeSubscriber } from "~/components/kanban/KanbanRealtimeSubscriber";

class WorkflowBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <section role="alert" className="p-6">
          <h1>Unable to display this workflow</h1>
          <p>Your saved work is still available.</p>
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
