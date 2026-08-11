import { NextRequest } from "next/server";
import { subscribeToKanbanEvents } from "~/lib/events/bus";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

/**
 * Server-sent event stream of kanban changes — the self-hosted replacement for
 * Supabase Realtime's postgres_changes subscription. Clients consume it via
 * `useKanbanRealtime`.
 */
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Client vanished between the abort signal and this write.
          closed = true;
        }
      };

      send(`retry: 3000\n\n`);
      send(`event: ready\ndata: {}\n\n`);

      const unsubscribe = subscribeToKanbanEvents((event) => {
        send(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
      });

      // Proxies drop idle connections; a comment frame keeps the pipe warm.
      const heartbeat = setInterval(
        () => send(`: heartbeat\n\n`),
        HEARTBEAT_MS
      );

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx buffers SSE into uselessness without this.
      "X-Accel-Buffering": "no",
    },
  });
}
