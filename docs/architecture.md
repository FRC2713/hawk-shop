# Hawk Shop architecture

Shop follows Hawk Eye's Astro architecture. The server renders page layout, navigation, account identity, and the overview. React islands own the manufacturing board, completed cards, equipment and process editor, and Onshape part selection. Each island keeps its existing query cache, drag-and-drop, dialogs, filters, bulk selection, and SSE subscription in one React root.

`src/pages/api/` retains the existing endpoint URLs and payloads. `src/server/` owns SQLite repositories, migrations, storage, and the event bus. `src/lib/api/` contains browser fetchers and shared query keys. The build rejects browser imports of modules marked `virtual:hawk-shop/server-only`.

SQLite, its ordered Drizzle migrations, and uploaded images retain their existing format and location under `DATA_DIR`. This migration does not replace the database or renumber existing users. The historical `users.onshape_user_id` column accepts Suite subjects for new Suite users; existing Onshape users remain available for historical assignment and submitter display. Cards created after migration record the verified Suite subject as submitter. Changing assignee leaves submitter intact.

## Authentication

The Suite gateway strips caller identity headers, authenticates the approved Slack workspace, and injects the same identity headers Hawk Eye reads. Shop validates the team, Slack user, subject, and exact `suite/member` role on every request. `HAWK_SUITE_TRUST_PROXY` defaults to false. Enabling it requires an isolated app network and a gateway that strips and replaces identity headers. An arbitrary caller able to reach the trusted app port could impersonate a member.

### Local development sign-in

Without a gateway, set `HAWK_SHOP_DEV_SIGNIN=true` in `.env` and run `npm run dev`. Every request from a loopback client (`127.0.0.1` or `::1`) is then signed in as the fixed member `slack:TLOCALDEV:ULOCALDEV` ("Local Developer"), defined in `src/server/dev-identity.ts`. Open the app at the `APP_URL` origin (default `http://localhost:3000`) so the same-origin check on writes passes. Signing out has no effect while the flag is on; remove it to see the signed-out screens.

It fails closed. The middleware imports the module only inside an `import.meta.env.DEV` branch, so `npm run build` drops it and the built server ignores the variable. It never applies when `HAWK_SUITE_TRUST_PROXY=true`, so gateway headers and the dev identity never mix, and it never applies to non-loopback clients, so `astro dev --host` does not sign in the LAN. `tests/dev-identity.test.ts` checks the build output contains none of it and that a built server with the flag set still refuses access.

Health checks, static files, and the embedded connection exchange remain public. Every data endpoint, uploaded image, live event stream, and mutation requires Suite membership, with one exception: `POST /api/onshape/webhook` (exact path and method), which Onshape calls without a Suite identity. It is enabled only when `ONSHAPE_WEBHOOK_SECRET` and `ONSHAPE_WEBHOOK_BASE_URL` are set, checks the secret in its query string, returns no shop data, and only clears that document's cached workspace reads. The gateway routes that exact path and method to the app without `authorize` (the `@shop-onshape-webhook` matcher in [ONSHAPE.md](ONSHAPE.md#webhooks)); everything else still goes through it. Same-origin checks cover JSON and multipart writes. Responses containing shop data are private and not cached by shared proxies.

CAD access uses one server-side Onshape API key pair (`ONSHAPE_ACCESS_KEY`, `ONSHAPE_SECRET_KEY`). Every request is HMAC-signed in `src/lib/onshapeApi/auth.ts`; the signing transport refuses non-Onshape hosts and re-signs bounded Onshape redirects. Users never connect an Onshape account, and the key never reaches the browser. Local cards, assignments, processes, equipment, uploads, and board configuration work without it. CAD operations report a missing key pair with HTTP 409; Suite session failures use HTTP 401. `/onshape` shows whether the key pair is configured.

All CAD reads and writes share the key's Onshape permissions, so its account should see only the robot documents. Existing disk caching and API usage accounting remain intact.

## Deployment handoff

`deploy/hawk-suite-auth.patch` contains the companion changes for the existing Hawk Suite authentication overlay. Review and apply it in the Suite repository before deploying this Shop image. It gates Shop through Suite, passes the approved workspace settings to Shop, and retains public health checks. It does not change Suite's pinned production release or deploy anything.

The iframe-only connector entry renders a connection screen without shop data when Suite identity is absent. A click opens `/auth/embed/authorize` in a popup. The gateway requires the ordinary top-level Suite session on that route, clearing any caller Authorization header and ignoring the embedded cookie. After sign-in, Shop returns a random, single-use code bound to the iframe's SHA-256 proof challenge. The popup sends the code only to its same-origin opener. The iframe checks both the message origin and popup window, then posts the code and verifier to the exact `/auth/embed/exchange` endpoint. The exchange requires Shop's browser Origin and JSON, expires codes after 60 seconds, and consumes them once. Codes live only in this single server process; restarting it requires reconnecting.

The exchange sets `__Host-hawk-shop-embedded`, a host-only `Secure; HttpOnly; SameSite=None; Partitioned` cookie with an eight-hour maximum lifetime. It contains the existing signed Suite access token. Caddy validates that token on every request using the same signing key, issuer, audience and membership role as the ordinary Suite session, and injects the usual identity headers. Shop never treats a raw embedded cookie as identity. The gateway returns authentication errors for API calls rather than redirecting fetches into Slack; an expired iframe navigation returns the connection screen with identity cleared. The shared Suite cookie stays SameSite=Lax. The embedded copy can remain valid until its cookie or signed token expires after signing out elsewhere, just like a copied bearer token; signing out through Shop clears the current partition's copy. No refresh token is copied.

The connector permits embedding only by itself or HTTPS Onshape subdomains using CSP `frame-ancestors`. No Onshape API key, Suite token, or refresh token enters page scripts, URLs, postMessage payloads, or JavaScript-readable storage. Browsers that block partitioned cookies show a connection error instead of a sign-in navigation loop. Onshape must allow popup windows from its iframe. The full Part Studio query stays in the original frame throughout connection and release.

Deploy the Shop image together with the Suite embedded-session routing changes. A Shop-only upgrade cannot authenticate iframe requests through an older gateway. See [embedded authentication](EMBEDDED_AUTH.md) for validation and rollout details.

The image now runs Node 24 and Astro's generated server entry at dist/server/entry.mjs, produced by `npm run build`. Preserve the existing `/data` volume. Starting the image without Suite configuration leaves health checks available and returns a setup error for data requests.

## Verification

Run `npm run typecheck`, `npm run format:check`, `npm run build`, and `npm test`. Install Chromium once with `npx playwright install chromium`.

The tests start the production build with a temporary SQLite database and fixture gateway identity. They exercise authentication rejection, safe login redirects, same-origin writes, card and equipment CRUD, assignment, quantities, column configuration, multipart images, SSE, cached CAD access, and browser hydration in desktop light and mobile dark themes. They do not call the live Onshape API or modify production data. The companion Suite patch was also exercised in a disposable Suite Caddy routing fixture. Re-run the Suite repository's checks when applying it to a newer Suite revision before deployment.
