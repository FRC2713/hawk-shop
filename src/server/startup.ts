import { startSlackWorker } from "~/lib/slack/worker";
// This entry is imported before Astro's Node listener starts. Durable pending
// notifications resume even when no browser has opened Shop since a restart.
const stop = startSlackWorker();
process.once("exit", stop);
