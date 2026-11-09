import { startSlackWorker } from "~/lib/slack/worker";
import { startOnshapeWebhookChecks } from "~/lib/onshapeApi/webhooks";
// This entry is imported before Astro's Node listener starts. Durable pending
// notifications resume even when no browser has opened Shop since a restart.
const stop = startSlackWorker();
process.once("exit", stop);
// Re-register webhooks Onshape dropped: shortly after boot, then daily. No
// calls when webhooks are disabled. The short delay lets the listener come up
// first: Onshape pings the callback during registration and cancels the
// webhook if nothing answers.
let stopWebhookChecks = () => {};
const bootCheck = setTimeout(() => {
  stopWebhookChecks = startOnshapeWebhookChecks();
}, 30_000);
bootCheck.unref();
process.once("exit", () => {
  clearTimeout(bootCheck);
  stopWebhookChecks();
});
