# Slack integration design

The design and ticket breakdown are approved for implementation. GitHub issues #28 through #32 track delivery on the Slack integration branch.

## Scope

- One integration installed in the Red Hawk Robotics Slack workspace. Individuals do not install or link the app.
- Publish messages in one configurable channel and mention the original submitter, regardless of the current assignee.
- Notification messages link back to Hawk Shop, with link buttons when the signing secret is configured. Commands and buttons that change a card are out of scope.
- Each released part gets one channel message with its details and thumbnail; later status changes reply in that message's thread. This replaced the first version's grouped posts (see Threads below).
- Links use the existing Hawk Shop address. Readers may need the shop network or VPN to open them; this integration does not introduce remote access.
- Submitters must belong to the destination channel for Slack app mentions to notify them.

## Identity

- Hawk Suite sign-in identifies each person by Slack member ID (subject `slack:<team>:<user>`). Cards record that subject as the submitter, so mentions and the administrator check use the member ID directly with `users.info`.
- Cards released before Suite sign-in record an Onshape ID. For those, look up the Slack member by the email saved for that person.
- If no Slack match is available, publish the update with the submitter's name and no mention. Do not guess by name.
- For legacy cards with no recorded submitter, publish the update labeled "Unknown submitter" without a mention.

## Triggers

Each released part gets one channel message, and the thread under it is that part's history:

- Releasing a part posts its message. A part released before threads existed, or while notifications were off, gets its message the first time its status changes.
- Every move between columns, including backward moves and moves by the submitter, replies in the thread naming who moved it and mentioning the submitter. Replies are not broadcast to the channel.
- Deleting the card replies "removed from the board".
- Reordering within a column and edits to other fields are silent. A project change edits the part's message instead of replying.
- Begin capturing changes when the integration is enabled, including future changes to existing cards. Do not replay historical changes.

The first version posted nothing on release or deletion, skipped a submitter's own moves, and grouped moves arriving within about 10 seconds. Threads replaced all of that: the channel holds one message per part, and the noise grouping guarded against stays in threads.

### Threads

The durable queue keeps per-card order. A reply waits until its part's message exists, and the message timestamp is stored per card and channel so restarts and retries keep replying in the same thread. Changing the destination channel starts new part messages in the new channel.

Thumbnails are uploaded to Slack as private files and referenced by Slack file ID, because Slack cannot fetch images from behind the Suite gateway. Slack messages never spend the Onshape API allocation: if the thumbnail is not already stored, the message goes out without it.

## Delivery and setup

- Board changes succeed without waiting for Slack.
- Persist pending notifications so they survive container restarts.
- Retry temporary failures for up to 24 hours. Show current delivery errors for pending notifications on the administrator page. Remove expired notifications when their retry window ends.
- An ambiguous Slack response followed by a retry can occasionally produce a duplicate message.
- Only active Red Hawk Robotics workspace administrators and owners may access the integration page. Channel managers alone do not qualify. It includes configuration as well as current integration health, pending notifications, and their current delivery errors. This supersedes the earlier read-only, deployment-only setup proposal.
- Administrators select the destination channel, enable or disable notifications, and send a test message through that page. The bot token stays in deployment environment variables.
- Verify the signed-in user's current Slack workspace role when opening the page and before every privileged operation, including configuration changes and test messages. Enforce this on the server for both reads and writes. Deny access if Slack cannot confirm the role; the manufacturing board remains available.
- Never expose bot credentials to ordinary signed-in users.
- Disabling notifications or changing the destination channel cancels unsent notifications. Do not replay them when re-enabled. New changes follow the updated configuration. A message already in flight may still arrive.
- Rely on automatic retries only; there is no manual retry button.
- Retain no delivery history. Remove delivered, expired, and canceled notification records. The durable queue stores only pending work and the information required to retry it. Integration health can show a current configuration or connectivity problem without retaining historical deliveries.

## Design status

No product decisions remain open from this interview. Reporting every intermediate transition is an initial choice to revisit if notifications become annoying. The first version does not include a configuration control for changing that policy.

## Implementation findings

These notes predate the move to Hawk Suite sign-in and an Onshape API key. Identity now comes from the Suite gateway, as described under Identity above.

The existing users table stores Onshape ID and name, but no email or Slack ID. The OAuth callback already receives an optional email from its existing user-info request. Card ownership is recorded separately from the manufacturing assignee.

The shared card update function is the natural place to capture column transitions. The current in-memory event bus has neither transition details nor durable delivery. Capture the card change and pending notification in one database transaction so a restart cannot split them.

The part-actions endpoint currently allows local status mutations without an explicit authentication check, despite the global middleware exempting API routes. Apply the repository's existing authentication rule to that endpoint before relying on its changes for Slack notifications.

The current Onshape user-ID cookie is unsigned and explicitly is not a security boundary. Administrator authorization must use a server-verified identity bound to the OAuth session, captured at sign-in, rather than trusting that cookie or a client-supplied ID. Pass that acting identity into status mutations to suppress self-notifications. Users without the new identity proof must sign in again before an action that requires it. No additional per-move Onshape user-info request is needed.

## Implementation graph

1. #28: Bind manufacturing actions to the signed-in person. No blockers.
2. #29: Configure Slack as a workspace administrator. Blocked by #28.
3. #30: Deliver reliable Slack status notifications. Blocked by #29.
4. #31: Group bursts of Slack status notifications. Blocked by #30.
5. #32: Show current Slack delivery problems to workspace administrators. Blocked by #30.

## Deployment setup

See [Slack setup](slack-setup.md) and the [outbound app manifest](slack-app-manifest.yaml). The `/slack` page manages durable channel selection and enabled state. The server requires a verified Hawk Suite identity and checks current Slack workspace authority for every settings, channel, save, and test request. `SLACK_BOT_TOKEN` stays in deployment configuration. The workspace pin defaults to `HAWK_SUITE_TEAM_ID`; `SLACK_WORKSPACE_ID` overrides it.

## Problem reports

Problem reports are a separate message type initiated by a button in Hawk Shop. Slack administrators may choose a second channel, with the status notification channel as the fallback; the bot token remains in deployment configuration and this adds no commands or buttons in Slack.

Reports use a durable pending queue processed by the existing Slack worker, transport, and posting cooldown. Their seven-day delivery window tolerates longer outages than status notifications. Disabling reports hides the action, rejects submissions, and pauses pending delivery; queued reports retain their original destination. Delivered receipts remain until the seven-day expiry so restarting the server or delivering a report cannot reset the five-per-ten-minute member limit.

Only whitelisted diagnostics are attached. Page query strings and fragments are omitted, text is bounded and escaped, and server-added member identity, revision, time, and report ID accompany each report. A receipt confirms durable acceptance, while delivery failures are logged with the report ID and retried. As with status notifications, an upstream timeout after Slack accepts a post can cause a duplicate on retry.

The shared header owns the dialog. Error displays can import `ReportProblemButton` from `~/components/app/report-problem` with `context` and optional prefilled `message`, or call `openProblemReport(context, message)` from `~/lib/api/reports`. The client-safe `ReportContext` accepts `page_path`, `card_id`, `error_id`, `error_message`, `user_agent`, and `viewport`. The dialog collects the current path, browser, and viewport itself. This works across React islands without a shared query provider; the button hides when the server-rendered page says reports are disabled.
