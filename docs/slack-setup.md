# Set up outbound Slack notifications

Hawk Shop uses one workspace bot in Red Hawk Robotics and one selected public or private channel. Individuals do not install or link accounts. Manufacturing works without Slack configuration and during Slack outages. Notifications are disabled until an administrator enables them.

## Install and deploy

1. A Red Hawk Robotics workspace administrator creates an app [from a manifest](https://docs.slack.dev/app-manifests/creating-apps-using-manifests/) using [slack-app-manifest.yaml](slack-app-manifest.yaml). Install it in Red Hawk Robotics. The bot scopes permit posting, channel discovery, member lookup, and thumbnail uploads (`files:write`). `users:read` checks members by Slack ID; `users:read.email` is only for cards released before Hawk Suite sign-in. Private channels require `groups:read`. No commands, incoming webhooks, events, signing secret, request URL, Socket Mode, or user OAuth scopes are needed. Under Basic Information › Display Information, upload [slack-app-icon.png](slack-app-icon.png) as the app icon ([slack-app-icon.svg](slack-app-icon.svg) is its source).
2. Copy the bot OAuth token from the Slack app's OAuth & Permissions page into the server deployment variable `SLACK_BOT_TOKEN`. Keep it out of source control, client configuration, logs, and browser storage. The bot's workspace defaults to `HAWK_SUITE_TEAM_ID`, which the Suite gateway configuration already sets. Set `SLACK_WORKSPACE_ID` only to override it, using an ID from the workspace operator or a trusted `auth.test` result. Never use an ID supplied by a browser. Hawk Shop compares the installed bot's `auth.test` team ID against this deployment pin on every privileged operation and rejects tokens from another workspace.
3. Set `APP_URL` to the actual Hawk Shop origin, including scheme and port. The Docker Compose file passes these variables into the container. Updating environment values requires recreating the container. Configure outbound HTTPS connectivity to `slack.com:443`; inbound Slack connectivity is unnecessary.
4. Invite the Hawk Shop bot to the destination channel with `/invite @Hawk Shop`, including for private channels. The channel picker lists only active public/private channels the bot has joined. Submitters must also belong to this channel for mentions to notify them.
5. Sign into Hawk Shop through Hawk Suite as an active Red Hawk Robotics Slack workspace administrator or owner. Hawk Shop takes your Slack member ID from the verified Suite identity and asks Slack for your current role. Email is not used. No client-provided header, email, or user-ID cookie grants access.
6. Open the user menu, then **Slack integration**. Choose the channel, save settings, and send a test message. The test contains no submitter mention and can be sent while notifications are disabled. Enable notifications and save when ready.

The channel and enabled state live in SQLite under `DATA_DIR` with the rest of Hawk Shop data and survive container restarts. Changes take effect without redeployment. Changing the channel or disabling notifications cancels unsent notifications, and re-enabling does not replay canceled work. A send already in flight may still arrive.

Hawk Shop links use the existing deployment address. Opening them may require the shop network or VPN. This integration does not create remote access.

## Access and troubleshooting

Every health read, configuration read, channel lookup, save, and test performs a fresh server-side Slack role check. Ordinary members, channel managers, inactive accounts, unmatched email addresses, and members of other workspaces cannot manage the integration. If Slack cannot confirm the current role, access is denied while the manufacturing board remains available.

- **Slack is not configured:** the deployment operator must set `SLACK_BOT_TOKEN` (and `HAWK_SUITE_TEAM_ID` or `SLACK_WORKSPACE_ID`) and recreate the container. They are optional for manufacturing.
- **Administrator access denied:** check that you signed in through Hawk Suite in the bot's workspace, your current workspace role and active status, and the pinned workspace ID. Workspace administrator or owner permissions are required; channel manager permissions are insufficient.
- **Invalid authentication or revoked token:** replace the server bot token and recreate the container. Do not paste the token into Hawk Shop or a support message.
- **Missing scope:** update the manifest and reinstall the app to grant its listed bot permissions.
- **Channel absent or inaccessible:** invite the bot, refresh channels, and choose an active channel. Archived channels, DMs, and group DMs are unsupported. Channel access is checked again before saving and testing. Slack posting restrictions may still prevent delivery.
- **Verification unavailable:** check outbound HTTPS, Slack service status, workspace pin, and deployment token. The client has a 10-second deadline per request, no hidden transport retries, and channel discovery stops after 100 pages or 30 seconds. Repeated cursors fail safely.
- **Rate limited:** wait before testing again. Test and production posts share serialized posting and a SQLite-backed pacing deadline. Slack's full `Retry-After` delay survives restart, and automatic delivery retries belong to the durable worker.
- **Save rejected by origin check:** verify `APP_URL` matches the origin used in the browser. Requests must originate from Hawk Shop, including when embedded in Onshape. Slack writes require JSON, a custom same-origin header, and the matching browser Origin. Iframe-compatible cookies do not exempt these checks.

Only stable error codes and safe guidance are returned. Slack response bodies, bearer tokens, and raw network exceptions are never included in Slack API responses or logs. The setup is outbound-only; there is no manual retry action or delivery history.

See Slack's [Web API](https://docs.slack.dev/apis/web-api/), [email lookup](https://docs.slack.dev/reference/methods/users.lookupByEmail/), [channel discovery](https://docs.slack.dev/reference/methods/conversations.list/), and [posting](https://docs.slack.dev/reference/methods/chat.postMessage/), and [file upload](https://docs.slack.dev/messaging/working-with-files/#uploading_files) documentation for permission and response details.

## Automatic delivery

Each released part gets its own channel message, and every later change to that part replies in the message's thread ([ADR-0003](adr/0003-part-threads.md)):

- **Release:** a rich message with the part name, quantity to make, quantity per robot, machine, processes, due date, status, release warnings, the submitter's mention, and links to the card in Hawk Shop and the part in Onshape. The part's thumbnail is attached when Hawk Shop has already stored it.
- **Every column move,** whoever made it, replies in the thread: `@submitter: Old → New · moved by Name`. Backward, intermediate and repeated moves all appear, in order.
- **Deleting the card** replies "removed from the board" when the part has a message.
- Reordering within a column and edits to other fields are silent.

Each event is captured in the same database transaction as the card change. Capture begins when notifications are enabled; enabling never replays earlier changes. A part released before that, or before threads existed, gets its message the first time its status changes, built from the card as it is then, and the move replies under it.

A submitter's Slack member ID comes from the Suite identity recorded at release and is confirmed as an active human member of the pinned workspace. Cards released before Suite sign-in carry an Onshape ID instead and fall back to the email saved for that person. If Slack cannot confirm the member, the message uses the recorded name; legacy cards without a submitter use "Unknown submitter".

**Thumbnails** are uploaded privately to Slack (`files:write`) and shown through the image block's Slack file, because Slack cannot load images from behind the Suite gateway. Hawk Shop never calls Onshape for a Slack message: a part whose thumbnail is not stored yet goes out without one. Uploading happens one worker pass before posting, so Slack has processed the file, and a retry never uploads twice. A failed upload, a missing `files:write` scope, or Slack rejecting the image block also sends the message without the picture. After adding `files:write` to an existing app, reinstall it from the app's settings; the bot token does not change.

The single-process Astro Node server starts its worker when the container starts, without waiting for board traffic. Board mutations never call Slack. Keep one server replica. The worker handles each card's events in order: a reply waits until the part's message exists, and a failed event blocks later events for that card only. Posts are spaced a second apart, so releasing many parts at once posts their messages one per second. Links open the card at `APP_URL/kanban?cardId=…` and retain the target through sign-in.

Thread anchors are stored per card and channel in `slack_threads` and removed once the card is deleted and nothing is left to send. Changing the destination channel starts new part messages there; old threads stay in the old channel. If someone deletes a part's message in Slack, the next update posts a new one.

Temporary delivery failures use exponential backoff from one second to one hour. Configuration failures wait 15 minutes between attempts. Slack method cooldowns and posting deadlines are shared with test messages and persist in SQLite. The full Slack `Retry-After` takes precedence; a deadline beyond a notification's lifetime causes expiry rather than an early send. Every pending event expires 24 hours after it was captured. Expired work is removed on startup even when Slack credentials are absent.

Delivered, expired and canceled pending records are deleted. There is no retained delivery history or manual retry action. An ambiguous network response can mean Slack accepted a post even though Hawk Shop could not confirm it, so automatic retry can occasionally produce a duplicate. External delivery is not exactly once.

Verification uses controlled transports only. Run `npm test`, `npm run typecheck`, and `npm run format:check`. After `npm run build`, run `npm run test:runtime` to also verify the production server drains pending work before any incoming HTTP requests and still serves authenticated API routes. The runtime test never contacts a real Slack workspace.

## Diagnose current delivery

The Slack integration page shows the saved enabled state and channel, checks current channel access, and lists unsent status changes. It refreshes every 15 seconds while open and verifies your current Slack administrator role each time. Use **Refresh delivery health** after correcting a problem. If role verification fails, the page hides delivery data and configuration until access can be verified again. The board remains available.

Each pending entry includes its captured part title, submitter name, status transition, earliest automatic attempt time, and 24-hour expiry. A later transition on the same card waits for the earlier transition. Slack posting cooldowns can also delay an attempt. A delivery error includes a stable code and the action to take. Connectivity and rate-limit errors retry automatically. Missing scopes, posting restrictions, and inaccessible channels require correcting the app installation or channel configuration before a retry can succeed. Tests use the saved channel and still require current administrator verification.

Disabled means new status changes are not captured. A current channel problem can still appear alongside that disabled state. Pending errors disappear with their pending work after success, cancellation, or expiry. An empty list does not confirm that Slack delivered an earlier notification. There is no sent/failed archive or manual retry control. Disabling or switching channels cancels unsent work immediately, including work waiting on a configuration fix. Re-enabling never restores it, and a message already in flight may still arrive.

## Problem reports

On the Slack settings page, a workspace administrator can enable **Problem reports** and choose a report channel. Invite the bot to that channel first. Leaving it blank uses the status notification channel. Reports are independent of status notifications and disabled by default.

Members use **Report a problem** in their account menu, the action in card details, or **Report this** beside an error. Reports attach the current page, selected card when available, member identity, app revision, browser, viewport, and error reference. Query strings, fragments, headers, and cookies are excluded. Each member can submit five reports per ten minutes. A confirmation means the report is saved durably for delivery; submission failures keep the text in the dialog.

Reports retry automatically for up to seven days using the shared Slack posting cooldown. Delivery failures are logged with the report ID. Disabling reports hides the action and pauses pending delivery; re-enabling resumes it before expiry. Queued reports keep their original channel even if the setting changes. An ambiguous Slack timeout may produce a duplicate post. Server errors log an `errorId` beside the stack trace; error displays include that same ID in reports. Render failures use a separate `client-` reference visible in the browser console.
