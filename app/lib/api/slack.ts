import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { queryKeys } from "./keys";
import type { SlackSettings, SlackDestination } from "~/lib/slack/types";
const privilegedHeaders = { "X-Hawk-Shop-Slack": "1" };
export const slackSettingsQuery = () =>
  queryOptions({
    queryKey: queryKeys.slack.settings(),
    queryFn: () => apiFetch<SlackSettings>("/api/slack/config"),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnMount: "always",
  });
export const slackChannelsQuery = () =>
  queryOptions({
    queryKey: queryKeys.slack.channels(),
    queryFn: () =>
      apiFetch<{ channels: SlackDestination[] }>("/api/slack/channels"),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnMount: "always",
  });
export const saveSlackSettings = (
  settings: Pick<SlackSettings, "channel_id" | "enabled">
) =>
  apiFetch<SlackSettings>("/api/slack/config", {
    method: "PUT",
    headers: privilegedHeaders,
    json: settings,
  });
export const sendSlackTest = () =>
  apiFetch<{ success: true }>("/api/slack/test", {
    method: "POST",
    headers: privilegedHeaders,
    json: {},
  });
