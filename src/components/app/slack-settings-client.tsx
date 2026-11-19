import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BellOff,
  CircleCheck,
  Clock,
  OctagonX,
  TriangleAlert,
} from "lucide-react";
import {
  slackStatusQuery,
  slackChannelsQuery,
  saveSlackSettings,
  sendSlackTest,
} from "~/lib/api/slack";
import { queryKeys } from "~/lib/api/keys";
import type { SlackDeliveryIssue, SlackStatus } from "~/lib/slack/types";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { cn } from "~/lib/utils";

const PAGE_DESCRIPTION =
  "Manage notifications for the Red Hawk Robotics workspace. Access requires a matching Onshape email and a current Slack workspace administrator or owner role.";

const codeClass =
  "bg-card rounded px-1 text-[0.85em] font-mono [overflow-wrap:anywhere]";
const selectClass =
  "border-input bg-background min-h-11 w-full rounded-md border p-2";
// Phone keeps 44px touch targets; desktop keeps the compact button.
const touchClass = "max-lg:min-h-11";
const pillClass =
  "bg-background inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold";

const shortTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** Sets environment variable names such as SLACK_BOT_TOKEN as code. */
function withCode(text: string): ReactNode[] {
  return text.split(/\b([A-Z][A-Z0-9]*_[A-Z0-9_]+)\b/).map((part, index) =>
    index % 2 ? (
      <code key={index} className={codeClass}>
        {part}
      </code>
    ) : (
      part
    )
  );
}

const HEALTH: Record<
  SlackStatus["health"]["state"],
  { label: string; rail: string; icon: ReactNode }
> = {
  ready: {
    label: "Ready for new status changes",
    rail: "callout-teal",
    icon: <CircleCheck className="text-icon-accent" />,
  },
  pending: {
    label: "Waiting to deliver",
    rail: "",
    icon: <Clock />,
  },
  disabled: {
    label: "Notifications disabled",
    rail: "",
    icon: <BellOff />,
  },
  problem: {
    label: "Delivery needs attention",
    rail: "callout-red",
    icon: <TriangleAlert />,
  },
};

function IssueCallout({ issue }: { issue: SlackDeliveryIssue }) {
  return (
    <div role="alert" className="callout callout-red flex gap-3 text-sm">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 space-y-1 break-words">
        <p>{withCode(issue.action)}</p>
        <p className="text-muted-foreground text-xs">Code: {issue.code}</p>
      </div>
    </div>
  );
}

function PageHeading() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl">Slack notifications</h1>
      <p className="text-muted-foreground">{PAGE_DESCRIPTION}</p>
    </div>
  );
}

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
  const [reportsEnabled, setReportsEnabled] = useState(false);
  const [reportsChannel, setReportsChannel] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (settings.data) {
      setChannel(settings.data.channel_id ?? "");
      setEnabled(settings.data.enabled);
      setReportsEnabled(settings.data.reports_enabled);
      setReportsChannel(settings.data.reports_channel_id ?? "");
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
      <div className="space-y-6">
        <PageHeading />
        <p role="status" className="text-muted-foreground">
          Checking Slack administrator access…
        </p>
      </div>
    );
  if (status.isError || !settings.data)
    return (
      <div className="space-y-6">
        <PageHeading />
        <div role="alert" className="callout callout-red flex gap-3">
          <OctagonX aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 space-y-1 break-words">
            <p className="font-heading font-semibold">Not available</p>
            <p>
              {withCode(
                status.error?.message ??
                  "Slack administrator access could not be verified."
              )}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          className={touchClass}
          onClick={() => settings.refetch()}
        >
          Check access again
        </Button>
      </div>
    );
  const currentSettings = settings.data;
  const health = HEALTH[status.data.health.state] ?? HEALTH.pending;
  const healthIssue = status.data.health.issue;
  const dirty =
    channel !== (currentSettings.channel_id ?? "") ||
    enabled !== currentSettings.enabled ||
    reportsEnabled !== currentSettings.reports_enabled ||
    reportsChannel !== (currentSettings.reports_channel_id ?? "");
  const busy = save.isPending || test.isPending || settings.isFetching;
  return (
    <div className="space-y-6">
      <PageHeading />
      <section aria-labelledby="slack-health" className="space-y-3">
        <h2 id="slack-health" className="text-xl">
          Current delivery health
        </h2>
        <div className={cn("callout flex gap-3", health.rail)}>
          <span aria-hidden="true" className="mt-0.5 shrink-0 [&_svg]:size-5">
            {health.icon}
          </span>
          <div className="min-w-0 space-y-1 break-words">
            <p className="font-heading font-semibold">{health.label}</p>
            <p className="text-muted-foreground text-sm">
              {currentSettings.channel_id
                ? `#${currentSettings.channel_name ?? currentSettings.channel_id}`
                : "No channel selected"}
            </p>
            {healthIssue && (
              <div role="alert" className="space-y-1 pt-1 text-sm">
                <p>{withCode(healthIssue.action)}</p>
                <p className="text-muted-foreground text-xs">
                  Code: {healthIssue.code}
                </p>
              </div>
            )}
          </div>
        </div>

        <p className="text-muted-foreground text-sm">
          Refreshes every 15 seconds while this page is open. Each refresh
          checks your current Slack administrator role.
        </p>
        <Button
          type="button"
          variant="outline"
          className={touchClass}
          disabled={status.isFetching}
          onClick={() => status.refetch()}
        >
          Refresh delivery health
        </Button>
      </section>
      <section aria-labelledby="slack-pending" className="space-y-3">
        <h2 id="slack-pending" className="text-xl">
          Pending notifications (
          <span className="brand-figures">{status.data.pending_count}</span>)
        </h2>
        {!status.data.pending.length && (
          <p className="text-muted-foreground">No pending notifications.</p>
        )}
        <ul className="space-y-3">
          {status.data.pending.map((row) => (
            <li
              key={row.id}
              className="space-y-3 rounded-md border p-4 break-words"
            >
              <div className="space-y-2">
                <p className="font-semibold">{row.title}</p>
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  {row.kind === "release" ? (
                    <>
                      Released into
                      <span className={pillClass}>{row.new_status}</span>
                    </>
                  ) : row.kind === "removed" ? (
                    "Removed from the board"
                  ) : (
                    <>
                      <span className={pillClass}>{row.old_status}</span>
                      <ArrowRight aria-hidden="true" className="size-4" />
                      <span className="sr-only">to</span>
                      <span className={pillClass}>{row.new_status}</span>
                    </>
                  )}
                </p>
                <p className="text-muted-foreground text-sm">
                  Submitter: {row.submitter_name}
                </p>
              </div>
              <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Changed</dt>
                <dd className="brand-figures">{shortTime(row.created_at)}</dd>
                <dt className="text-muted-foreground">
                  {row.attempts ? "Next retry" : "First attempt"}
                </dt>
                <dd className="brand-figures">
                  {shortTime(row.next_attempt_at)}
                </dd>
                <dt className="text-muted-foreground">Expires</dt>
                <dd className="brand-figures">{shortTime(row.expires_at)}</dd>
              </dl>
              <p className="text-muted-foreground text-xs">
                Sends no earlier than the time shown. Earlier changes to the
                same card must finish first.
              </p>
              {row.issue &&
                (row.issue.code === healthIssue?.code ? (
                  <p className="text-muted-foreground text-sm">
                    Blocked by the issue above.
                  </p>
                ) : (
                  <IssueCallout issue={row.issue} />
                ))}
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
        aria-labelledby="slack-settings-heading"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setNotice("");
          save.mutate({
            channel_id: channel || null,
            enabled,
            reports_enabled: reportsEnabled,
            reports_channel_id: reportsChannel || null,
          });
        }}
      >
        <h2 id="slack-settings-heading" className="text-xl">
          Settings
        </h2>
        <fieldset className="space-y-3 rounded-md border p-4 pt-1">
          <legend className="font-heading px-1 font-semibold">
            Status notifications
          </legend>
          <label
            htmlFor="slack-enabled"
            className="flex min-h-11 cursor-pointer items-center gap-3"
          >
            <Checkbox
              id="slack-enabled"
              checked={enabled}
              onCheckedChange={(value) => setEnabled(value === true)}
              disabled={busy}
            />
            Enable status notifications
          </label>
          <div className="space-y-2">
            <label htmlFor="slack-channel" className="block font-medium">
              Destination channel
            </label>
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-stretch">
              <select
                id="slack-channel"
                className={selectClass}
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
                      {currentSettings.channel_name ??
                        currentSettings.channel_id}{" "}
                      (saved)
                    </option>
                  )}
                {channels.data?.channels.map((item) => (
                  <option key={item.id} value={item.id}>
                    #{item.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 shrink-0"
                disabled={busy || channels.isFetching}
                onClick={() => channels.refetch()}
              >
                Refresh channels
              </Button>
            </div>
            {channels.isPending && (
              <p role="status" className="text-muted-foreground text-sm">
                Loading channels…
              </p>
            )}
            {channels.isError && (
              <p role="alert" className="text-emphasis text-sm">
                {channels.error.message}
              </p>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            Invite the Hawk Shop bot to a public or private channel to list it
            here. Submitters must belong to that channel for mentions to notify
            them. Disabling notifications or changing the channel cancels unsent
            notifications. A message already sending may still arrive.
          </p>
        </fieldset>
        <fieldset className="space-y-3 rounded-md border p-4 pt-1">
          <legend className="font-heading px-1 font-semibold">
            Problem reports
          </legend>
          <label
            htmlFor="slack-reports-enabled"
            className="flex min-h-11 cursor-pointer items-center gap-3"
          >
            <Checkbox
              id="slack-reports-enabled"
              checked={reportsEnabled}
              onCheckedChange={(value) => setReportsEnabled(value === true)}
              disabled={busy}
            />
            Enable problem reports
          </label>
          <div className="space-y-2">
            <label
              htmlFor="reports-channel"
              className={cn(
                "block font-medium",
                !reportsEnabled && "opacity-60"
              )}
            >
              Problem report channel
            </label>
            <select
              id="reports-channel"
              className={cn(selectClass, !reportsEnabled && "opacity-60")}
              value={reportsChannel}
              onChange={(event) => setReportsChannel(event.target.value)}
              disabled={busy || !channels.isSuccess}
            >
              <option value="">Use status notification channel</option>
              {reportsChannel &&
                !channels.data?.channels.some(
                  (item) => item.id === reportsChannel
                ) && (
                  <option value={reportsChannel}>
                    {reportsChannel} (saved)
                  </option>
                )}
              {channels.data?.channels.map((item) => (
                <option key={item.id} value={item.id}>
                  #{item.name}
                </option>
              ))}
            </select>
          </div>
          <p className="text-muted-foreground text-sm">
            Reports are saved for up to seven days while Slack is unavailable.
            Disabling reports pauses pending delivery. Pending reports keep
            their original channel.
          </p>
        </fieldset>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              className={touchClass}
              disabled={
                busy ||
                !dirty ||
                (enabled && !channel) ||
                (reportsEnabled && !reportsChannel && !channel)
              }
            >
              {save.isPending ? "Saving…" : "Save settings"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className={touchClass}
              disabled={busy || dirty || !currentSettings.channel_id}
              onClick={() => {
                setNotice("");
                test.mutate();
              }}
            >
              {test.isPending ? "Sending…" : "Send test message"}
            </Button>
          </div>
          {(save.error || test.error) && (
            <p role="alert" className="text-emphasis text-sm">
              {save.error?.message ?? test.error?.message}
            </p>
          )}
          {notice && (
            <p role="status" className="flex items-center gap-2 text-sm">
              <CircleCheck
                aria-hidden="true"
                className="text-icon-accent size-4 shrink-0"
              />
              {notice}
            </p>
          )}
          <p className="text-muted-foreground text-sm">
            Save changes before testing. Tests work while notifications are
            disabled and never mention a submitter.
          </p>
        </div>
      </form>
      <p className="text-muted-foreground border-t pt-4 text-sm">
        Hawk Shop links may require the shop network or VPN. Manufacturing
        continues if Slack is unavailable.
      </p>
    </div>
  );
}
