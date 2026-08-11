import "@tanstack/react-start/server-only";

import { EventEmitter } from "node:events";

/**
 * In-process pub/sub replacing Supabase Realtime.
 *
 * Mutations publish here; `/api/kanban/events` turns that into an SSE stream and
 * connected boards invalidate their queries. This is deliberately single-process
 * — a self-hosted install is one container. If you ever run more than one
 * replica, swap this module for Redis pub/sub and the rest of the app is
 * unaffected.
 */

export type KanbanEvent = {
  table: "kanban_cards" | "kanban_config";
  action: "insert" | "update" | "delete";
  id?: string;
};

const globalForBus = globalThis as unknown as {
  __hawkShopBus?: EventEmitter;
};

const bus =
  globalForBus.__hawkShopBus ??
  (() => {
    const emitter = new EventEmitter();
    // One listener per open SSE connection; the default cap of 10 is far too low.
    emitter.setMaxListeners(0);
    globalForBus.__hawkShopBus = emitter;
    return emitter;
  })();

const CHANNEL = "kanban";

export function publishKanbanEvent(event: KanbanEvent): void {
  bus.emit(CHANNEL, event);
}

export function subscribeToKanbanEvents(
  listener: (event: KanbanEvent) => void
): () => void {
  bus.on(CHANNEL, listener);
  return () => {
    bus.off(CHANNEL, listener);
  };
}
