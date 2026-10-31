# Set up outbound Slack notifications

Hawk Shop uses one workspace bot in Red Hawk Robotics and one selected public or private channel. Individuals do not install or link accounts. Manufacturing works without Slack configuration and during Slack outages. Notifications are disabled until an administrator enables them.

## Install and deploy

1. A Red Hawk Robotics workspace administrator creates an app [from a manifest](https://docs.slack.dev/app-manifests/creating-apps-using-manifests/) using [slack-app-manifest.yaml](slack-app-manifest.yaml). Install it in Red Hawk Robotics. The bot scopes permit posting, channel discovery, and member identity lookup. Private channels require `groups:read`. No commands, incoming webhooks, events, signing secret, request URL, Socket Mode, or user OAuth scopes are needed.
2. Copy the bot OAuth token from the Slack app's OAuth & Permissions page into the server deployment variable `SLACK_BOT_TOKEN`. Keep it out of source control, client configuration, logs, and browser storage. Store the verified Red Hawk Robotics workspace ID in `SLACK_WORKSPACE_ID`. Obtain this ID from the workspace operator or a trusted `auth.test` result. Never use an ID supplied by a browser. Hawk Shop compares the installed bot's `auth.test` team ID against this deployment pin on every privileged operation and rejects tokens from another workspace.
3. Set `APP_URL` to the actual Hawk Shop origin, including scheme and port. The Docker Compose file passes these variables into the container. Updating environment values requires recreating the container. Configure outbound HTTPS connectivity to `slack.com:443`; inbound Slack connectivity is unnecessary.
4. Invite the Hawk Shop bot to the destination channel with `/invite @Hawk Shop`, including for private channels. The channel picker lists only active public/private channels the bot has joined. Submitters must also belong to this channel for mentions to notify them.
5. Sign into Hawk Shop using an Onshape account whose saved sign-in email matches an active Red Hawk Robotics Slack workspace administrator or owner. Existing sessions without trusted identity must sign in again. If the email changed, sign out and sign back in. No client-provided email or user-ID cookie grants access.
6. Open the user menu, then **Slack integration**. Choose the channel, save settings, and send a test message. The test contains no submitter mention and can be sent while notifications are disabled. Enable notifications and save when ready.

The channel and enabled state live in SQLite under `DATA_DIR` with the rest of Hawk Shop data and survive container restarts. Changes take effect without redeployment. Changing the channel or disabling notifications cancels unsent notifications, and re-enabling does not replay canceled work. A send already in flight may still arrive.

Hawk Shop links use the existing deployment address. Opening them may require the shop network or VPN. This integration does not create remote access.

## Access and troubleshooting

Every configuration read, channel lookup, save, and test performs a fresh server-side Slack role check. Ordinary members, channel managers, inactive accounts, unmatched email addresses, and members of other workspaces cannot manage the integration. If Slack cannot confirm the current role, access is denied while the manufacturing board remains available.

- **Slack is not configured:** the deployment operator must set both environment values and recreate the container. They are optional for manufacturing.
- **Administrator access denied:** check the Onshape email captured at the latest sign-in, the member's current workspace role, active status, and the pinned workspace ID. Workspace administrator or owner permissions are required; channel manager permissions are insufficient.
- **Invalid authentication or revoked token:** replace the server bot token and recreate the container. Do not paste the token into Hawk Shop or a support message.
- **Missing scope:** update the manifest and reinstall the app to grant its listed bot permissions.
- **Channel absent or inaccessible:** invite the bot, refresh channels, and choose an active channel. Archived channels, DMs, and group DMs are unsupported. Channel access is checked again before saving and testing. Slack posting restrictions may still prevent delivery.
- **Verification unavailable:** check outbound HTTPS, Slack service status, workspace pin, and deployment token. The client has a 10-second deadline per request, no hidden transport retries, and channel discovery stops after 100 pages or 30 seconds. Repeated cursors fail safely.
- **Rate limited:** wait before testing again. Test and production posts share serialized posting and a SQLite-backed pacing deadline. Slack's full `Retry-After` delay survives restart, and automatic delivery retries belong to the durable worker.
- **Save rejected by origin check:** verify `APP_URL` matches the origin used in the browser. Requests must originate from Hawk Shop, including when embedded in Onshape. Slack writes require JSON, a custom same-origin header, and the matching browser Origin. Iframe-compatible cookies do not exempt these checks.

Only stable error codes and safe guidance are returned. Slack response bodies, bearer tokens, and raw network exceptions are never included in Slack API responses or logs. The setup is outbound-only; there is no manual retry action or delivery history.

See Slack's [Web API](https://docs.slack.dev/apis/web-api/), [email lookup](https://docs.slack.dev/reference/methods/users.lookupByEmail/), [channel discovery](https://docs.slack.dev/reference/methods/conversations.list/), and [posting](https://docs.slack.dev/reference/methods/chat.postMessage/) documentation for permission and response details.

## Automatic delivery

Every real column move by someone other than the original submitter captures a durable transition snapshot in the same transaction as the card update. Initial releases, same-column moves, ordinary edits, deletions and self-moves are silent. Capture begins when enabled; enabling never replays earlier changes. A submitter's saved Onshape email is matched to an active human Slack member in the pinned workspace. Missing email or an unmatched member uses the recorded name; legacy cards without a submitter use "Unknown submitter".

The single-process Nitro server starts its worker when the container starts, without waiting for board traffic. Board mutations never call Slack. Keep one server replica. The worker posts in each card's transition order and uses the captured names, statuses and quantities, including after later edits or deletion. Links open that specific card's details at `APP_URL/kanban?cardId=…` and retain the target through sign-in. Deleted cards show an unavailable message.

Temporary delivery failures use exponential backoff from one second to one hour. Configuration failures wait 15 minutes between attempts. Slack method cooldowns and posting deadlines are shared with test messages and persist in SQLite. The full Slack `Retry-After` takes precedence; a deadline beyond a notification's lifetime causes expiry rather than an early send. Every pending notification expires 24 hours after its original transition. Expired work is removed on startup even when Slack credentials are absent.

Delivered, expired and canceled pending records are deleted. There is no retained delivery history or manual retry action. An ambiguous network response can mean Slack accepted a post even though Hawk Shop could not confirm it, so automatic retry can occasionally produce a duplicate. External delivery is not exactly once.

Verification uses controlled transports only. Run `npm test`, `npm run typecheck`, and `npm run format:check`. After `npm run build`, run `npm run test:runtime` to also verify the production server drains pending work before any incoming HTTP requests and still serves authenticated API routes. The runtime test never contacts a real Slack workspace.
