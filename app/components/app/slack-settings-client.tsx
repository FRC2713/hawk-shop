import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  slackStatusQuery,
  slackChannelsQuery,
  saveSlackSettings,
  sendSlackTest,
} from "~/lib/api/slack";
import { queryKeys } from "~/lib/api/keys";
import { Button } from "~/components/ui/button";

export function SlackSettingsClient() {
  const status = useQuery(slackStatusQuery());
  const settings = { ...status, data: status.data?.settings };
  const channels = useQuery({
    ...slackChannelsQuery(),
    enabled: status.isSuccess,
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
  }, [settings.data?.generation, settings.data?.updated_at]);
  const refresh = () =>
    client.invalidateQueries({ queryKey: queryKeys.slack.status() });
  const save = useMutation({
    onSettled: refresh,
    mutationFn: saveSlackSettings,
    onSuccess: async () => {
      setNotice("Slack settings saved.");
      await client.invalidateQueries({ queryKey: queryKeys.slack.settings() });
    },
  });
  const test = useMutation({
    onSettled: refresh,
    mutationFn: sendSlackTest,
    onSuccess: () => setNotice("Test message sent to the saved channel."),
  });
  if (status.isPending)
    return (
      <div className="p-6" role="status">
        Checking Slack administrator access…
      </div>
    );
  if (status.isError || !settings.data)
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">Slack integration</h1>
        <p className="mt-4" role="alert">
          {status.error?.message ??
            "Slack administrator access could not be verified."}
        </p>
        <Button className="mt-4" onClick={() => settings.refetch()}>
          Check access again
        </Button>
      </div>
    );
  const currentSettings = settings.data;
  const dirty =
    channel !== (currentSettings.channel_id ?? "") ||
    enabled !== currentSettings.enabled;
  const busy = save.isPending || test.isPending || settings.isFetching;
  return (
    <main className="h-full min-h-0 w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl space-y-6 p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-semibold">Slack integration</h1>
          <p className="text-muted-foreground mt-2">
            Manage notifications for the Red Hawk Robotics workspace. Access
            requires a matching Onshape email and a current Slack workspace
            administrator or owner role.
          </p>
        </div>
        <section
          aria-labelledby="slack-health"
          className="space-y-3 rounded-md border p-4"
        >
          <h2 id="slack-health" className="text-lg font-semibold">
            Current delivery health
          </h2>
          <p>
            {status.data?.health.state === "disabled"
              ? "Notifications disabled"
              : status.data?.health.state === "problem"
                ? "Delivery needs attention"
                : status.data?.health.state === "pending"
                  ? "Waiting to deliver"
                  : "Ready for new status changes"}
            {currentSettings.channel_id
              ? ` · #${currentSettings.channel_name ?? currentSettings.channel_id}`
              : " · No channel selected"}
          </p>
          {status.data?.health.issue && (
            <p role="alert" className="text-sm break-words">
              {status.data.health.issue.code}: {status.data.health.issue.action}
            </p>
          )}
          <p className="text-muted-foreground text-sm">
            Refreshes every 15 seconds while this page is open. Each refresh
            checks your current Slack administrator role.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={status.isFetching}
            onClick={() => status.refetch()}
          >
            Refresh delivery health
          </Button>
        </section>
        <section aria-labelledby="slack-pending" className="space-y-3">
          <h2 id="slack-pending" className="text-lg font-semibold">
            Pending notifications ({status.data?.pending_count ?? 0})
          </h2>
          {!status.data?.pending.length && (
            <p className="text-muted-foreground">No pending notifications.</p>
          )}
          <ul className="space-y-3">
            {status.data?.pending.map((row) => (
              <li
                key={row.id}
                className="space-y-2 rounded-md border p-4 break-words"
              >
                <p className="font-medium">{row.title}</p>
                <p>
                  {row.old_status} → {row.new_status}
                </p>
                <p className="text-sm">Submitter: {row.submitter_name}</p>
                <p className="text-muted-foreground text-sm">
                  Changed {new Date(row.created_at).toLocaleString()}. Expires{" "}
                  {new Date(row.expires_at).toLocaleString()}.
                </p>
                <p className="text-sm">
                  {row.attempts ? "Automatic retry" : "First delivery attempt"}{" "}
                  no earlier than{" "}
                  {new Date(row.next_attempt_at).toLocaleString()}. Earlier
                  changes to the same card must finish first.
                </p>
                {row.issue && (
                  <p role="alert" className="text-sm">
                    {row.issue.code}: {row.issue.action}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-sm">
            Only unsent work appears here. Delivered, canceled, and expired
            notifications are deleted. Automatic retries stop 24 hours after the
            status change.
          </p>
        </section>
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
              {currentSettings.channel_id &&
                !channels.data?.channels.some(
                  (item) => item.id === currentSettings.channel_id
                ) && (
                  <option value={currentSettings.channel_id}>
                    #
                    {currentSettings.channel_name ?? currentSettings.channel_id}{" "}
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
              here. Submitters must belong to that channel for mentions to
              notify them.
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
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              disabled={busy || !dirty || (enabled && !channel)}
            >
              {save.isPending ? "Saving…" : "Save settings"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || dirty || !currentSettings.channel_id}
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
      </div>
    </main>
  );
}
