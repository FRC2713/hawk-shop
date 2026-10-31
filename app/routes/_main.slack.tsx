import { createFileRoute } from "@tanstack/react-router";
import { SlackSettingsClient } from "~/components/app/slack-settings-client";
export const Route = createFileRoute("/_main/slack")({
  component: SlackSettingsClient,
});
