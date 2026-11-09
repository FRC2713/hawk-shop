# Hawk Shop architecture

Shop follows Hawk Eye's Astro architecture. The server renders page layout, navigation, account identity, and the overview. React islands own the manufacturing board, completed cards, equipment and process editor, and Onshape part selection. Each island keeps its existing query cache, drag-and-drop, dialogs, filters, bulk selection, and SSE subscription in one React root.

`src/pages/api/` retains the existing endpoint URLs and payloads. `src/server/` owns SQLite repositories, migrations, storage, and the event bus. `src/lib/api/` contains browser fetchers and shared query keys. The build rejects browser imports of modules marked `virtual:hawk-shop/server-only`.

SQLite, its ordered Drizzle migrations, and uploaded images retain their existing format and location under `DATA_DIR`. This migration does not replace the database or renumber existing users. The historical `users.onshape_user_id` column accepts Suite subjects for new Suite users; existing Onshape users remain available for historical assignment and submitter display. Cards created after migration record the verified Suite subject as submitter. Changing assignee leaves submitter intact.

## Authentication

The Suite gateway strips caller identity headers, authenticates the approved Slack workspace, and injects the same identity headers Hawk Eye reads. Shop validates the team, Slack user, subject, and exact `suite/member` role on every request. `HAWK_SUITE_TRUST_PROXY` defaults to false. Enabling it requires an isolated app network and a gateway that strips and replaces identity headers. An arbitrary caller able to reach the trusted app port could impersonate a member.

Health checks and static files remain public. Every data endpoint, uploaded image, live event stream, and mutation requires Suite membership, with one exception: `POST /api/onshape/webhook` (exact path and method), which Onshape calls without a Suite identity. It is enabled only when `ONSHAPE_WEBHOOK_SECRET` and `ONSHAPE_WEBHOOK_BASE_URL` are set, checks the secret in its query string, returns no shop data, and only clears that document's cached workspace reads. The gateway routes that exact path and method to the app without `authorize` (the `@shop-onshape-webhook` matcher in [ONSHAPE.md](ONSHAPE.md#webhooks)); everything else still goes through it. Same-origin checks cover JSON and multipart writes. Responses containing shop data are private and not cached by shared proxies.

CAD access uses one server-side Onshape API key pair (`ONSHAPE_ACCESS_KEY`, `ONSHAPE_SECRET_KEY`). Every request is HMAC-signed in `src/lib/onshapeApi/auth.ts`; the signing transport refuses non-Onshape hosts and re-signs bounded Onshape redirects. Users never connect an Onshape account, and the key never reaches the browser. Local cards, assignments, processes, equipment, uploads, and board configuration work without it. CAD operations report a missing key pair with HTTP 409; Suite session failures use HTTP 401. `/onshape` shows whether the key pair is configured.

All CAD reads and writes share the key's Onshape permissions, so its account should see only the robot documents. Existing disk caching and API usage accounting remain intact.

## Deployment handoff

`deploy/hawk-suite-auth.patch` contains the companion changes for the existing Hawk Suite authentication overlay. Review and apply it in the Suite repository before deploying this Shop image. It gates Shop through Suite, passes the approved workspace settings to Shop, and retains public health checks. It does not change Suite's pinned production release or deploy anything.

The iframe-only connector entry bypasses gateway authorization to show a top-level continuation, with all caller identity headers cleared. It returns no shop data. The top-level request then passes through the normal Suite gate and preserves the original Part Studio query. This supports Suite's SameSite=Lax cookies without opening any API or CAD operation to unauthenticated callers.

The image now runs Node 24 and Astro's `dist/server/entry.mjs`. Preserve the existing `/data` volume. Starting the image without Suite configuration leaves health checks available and returns a setup error for data requests.

## Verification

Run `npm run typecheck`, `npm run format:check`, `npm run build`, and `npm test`. Install Chromium once with `npx playwright install chromium`.

The tests start the production build with a temporary SQLite database and fixture gateway identity. They exercise authentication rejection, safe login redirects, same-origin writes, card and equipment CRUD, assignment, quantities, column configuration, multipart images, SSE, cached CAD access, and browser hydration in desktop light and mobile dark themes. They do not call the live Onshape API or modify production data. The companion Suite patch was also exercised in a disposable Suite Caddy routing fixture. Re-run the Suite repository's checks when applying it to a newer Suite revision before deployment.
