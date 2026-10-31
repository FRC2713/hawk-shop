import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  slackSettingsQuery,
  slackChannelsQuery,
  saveSlackSettings,
  sendSlackTest,
} from "~/lib/api/slack";
import { queryKeys } from "~/lib/api/keys";
import { Button } from "~/components/ui/button";

export function SlackSettingsClient() {
  const settings = useQuery(slackSettingsQuery());
  const channels = useQuery({
    ...slackChannelsQuery(),
    enabled: settings.isSuccess,
  });
  const client = useQueryClient();
  const [channel, setChannel] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (settings.data) {
      setChannel(settings.data.channel_id ?? "");
      setEnabled(settings.data.enabled);
    }
  }, [settings.data]);
  const save = useMutation({
    mutationFn: saveSlackSettings,
    onSuccess: async () => {
      setNotice("Slack settings saved.");
      await client.invalidateQueries({ queryKey: queryKeys.slack.settings() });
    },
  });
  const test = useMutation({
    mutationFn: sendSlackTest,
    onSuccess: () => setNotice("Test message sent to the saved channel."),
  });
  if (settings.isPending)
    return (
      <div className="p-6" role="status">
        Checking Slack administrator access…
      </div>
    );
  if (settings.isError)
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">Slack integration</h1>
        <p className="mt-4" role="alert">
          {settings.error.message}
        </p>
        <Button className="mt-4" onClick={() => settings.refetch()}>
          Check access again
        </Button>
      </div>
    );
  const dirty =
    channel !== (settings.data.channel_id ?? "") ||
    enabled !== settings.data.enabled;
  const busy = save.isPending || test.isPending || settings.isFetching;
  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Slack integration</h1>
        <p className="text-muted-foreground mt-2">
          Manage notifications for the Red Hawk Robotics workspace. Access
          requires a matching Onshape email and a current Slack workspace
          administrator or owner role.
        </p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setNotice("");
          save.mutate({ channel_id: channel || null, enabled });
        }}
      >
        <div className="space-y-2">
          <label htmlFor="slack-channel" className="block font-medium">
            Destination channel
          </label>
          <select
            id="slack-channel"
            className="border-input bg-background w-full rounded-md border p-2"
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
            disabled={busy || !channels.isSuccess}
          >
            <option value="">Choose a channel</option>
            {settings.data.channel_id &&
              !channels.data?.channels.some(
                (item) => item.id === settings.data.channel_id
              ) && (
                <option value={settings.data.channel_id}>
                  #{settings.data.channel_name ?? settings.data.channel_id}{" "}
                  (saved)
                </option>
              )}
            {channels.data?.channels.map((item) => (
              <option key={item.id} value={item.id}>
                #{item.name}
              </option>
            ))}
          </select>
          {channels.isPending && <p role="status">Loading channels…</p>}
          {channels.isError && <p role="alert">{channels.error.message}</p>}
          <p className="text-muted-foreground text-sm">
            Invite the Hawk Shop bot to a public or private channel to list it
            here. Submitters must belong to that channel for mentions to notify
            them.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy || channels.isFetching}
            onClick={() => channels.refetch()}
          >
            Refresh channels
          </Button>
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            disabled={busy}
          />
          Enable status notifications
        </label>
        <p className="text-muted-foreground text-sm">
          Disabling notifications or changing the channel cancels unsent
          notifications. A message already sending may still arrive.
        </p>
        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={busy || !dirty || (enabled && !channel)}
          >
            {save.isPending ? "Saving…" : "Save settings"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || dirty || !settings.data.channel_id}
            onClick={() => {
              setNotice("");
              test.mutate();
            }}
          >
            {test.isPending ? "Sending…" : "Send test message"}
          </Button>
        </div>
        <p className="text-muted-foreground text-sm">
          Save changes before testing. Tests work while notifications are
          disabled and never mention a submitter.
        </p>
      </form>
      {(save.error || test.error) && (
        <p role="alert" className="text-destructive">
          {save.error?.message ?? test.error?.message}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <p className="text-muted-foreground text-sm">
        Hawk Shop links may require the shop network or VPN. Manufacturing
        continues if Slack is unavailable.
      </p>
    </main>
  );
}
