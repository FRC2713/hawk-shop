# Slack integration design

The design and ticket breakdown are approved for implementation. GitHub issues #28 through #32 track delivery on the Slack integration branch.

## Scope

- One integration installed in the Red Hawk Robotics Slack workspace. Individuals do not install or link the app.
- Publish messages in one configurable channel and mention the original submitter, regardless of the current assignee.
- Notification messages link back to Hawk Shop. Commands and status-changing buttons are outside the first version.
- Each grouped notification is a new channel post containing the submitter mention, old and new statuses, and each part's name, quantity to make, and Hawk Shop link. Thumbnails and per-part threads are outside the first version.
- Links use the existing Hawk Shop address. Readers may need the shop network or VPN to open them; this integration does not introduce remote access.
- Submitters must belong to the destination channel for Slack app mentions to notify them.

## Identity

- Persist the email received from Onshape at sign-in and use it to look up the matching Slack member.
- Existing users acquire a saved email on their next sign-in. Do not add Onshape API calls solely to backfill emails.
- If no Slack match is available, publish the update with the submitter's name and no mention. Do not guess by name.
- For legacy cards with no recorded submitter, publish the update labeled "Unknown submitter" without a mention.

## Triggers and grouping

- Notify on every move between columns, including backward moves.
- Reordering within a column and edits to other fields are silent.
- Initial release and deletion are silent.
- A submitter moving their own part does not produce a notification. Changes by other people remain eligible.
- Begin capturing changes when the integration is enabled, including future changes to existing cards. Do not replay historical changes.
- Group updates arriving within roughly 10 seconds by submitter and status transition. List the affected parts in the message; keep distinct transitions visible.
- Preserve intermediate transitions during rapid moves and outage recovery within the delivery window. Start with this behavior, but revisit it if the channel becomes noisy.

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

See [Slack setup](slack-setup.md) and the [outbound app manifest](slack-app-manifest.yaml). The `/slack` page manages durable channel selection and enabled state. The server requires a verified OAuth session actor and checks current Slack workspace authority for every settings, channel, save, and test request. `SLACK_BOT_TOKEN` and the trusted Red Hawk Robotics `SLACK_WORKSPACE_ID` stay in deployment configuration.
