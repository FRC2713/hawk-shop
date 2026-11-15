import { startSlackWorker } from "~/lib/slack/worker";
// This entry is imported before Astro's Node listener starts. Durable pending
// notifications resume even when no browser has opened Shop since a restart.
// Onshape webhook upkeep has no timer: it runs on evidence from parts reads
// and deliveries (see `~/lib/onshapeApi/webhooks`), so boot costs no calls.
const stop = startSlackWorker();
process.once("exit", stop);
