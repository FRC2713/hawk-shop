import { definePlugin } from "nitro";

export default definePlugin((nitroApp) => {
  if (import.meta.prerender) return;
  let closed = false;
  let stop: (() => void) | undefined;
  nitroApp.hooks.hook("close", () => {
    closed = true;
    stop?.();
  });
  // Importing this plugin at build time neither opens SQLite nor starts work.
  void import("../../app/lib/slack/worker")
    .then(({ startSlackWorker }) => {
      if (!closed) stop = startSlackWorker();
    })
    .catch(() => console.error("[SLACK] Worker startup unavailable"));
});
