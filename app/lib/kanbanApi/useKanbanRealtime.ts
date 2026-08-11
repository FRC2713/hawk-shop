import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "~/lib/api";

/**
 * Subscribes to `/api/kanban/events` and invalidates the cards query whenever
 * the server reports a change. EventSource reconnects on its own, so a server
 * restart heals without a page reload.
 */
export function useKanbanRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof EventSource === "undefined") return;

    const source = new EventSource("/api/kanban/events");

    const onChange = () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.kanban.cards() });
    };

    source.addEventListener("change", onChange);

    // A reconnect can miss events that landed while we were disconnected, so
    // refetch once the stream comes back up.
    source.addEventListener("ready", onChange);

    return () => {
      source.removeEventListener("change", onChange);
      source.removeEventListener("ready", onChange);
      source.close();
    };
  }, [queryClient]);
}
