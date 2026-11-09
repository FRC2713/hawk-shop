# Release parts inside Onshape

Open Hawk Shop in an Onshape Part Studio and click **Connect Hawk Suite**. A popup uses the existing Suite login, or asks for Slack sign-in. Once connected, it closes and the original iframe loads part selection. Releases and their dialogs stay inside Onshape. The Part Studio query is preserved without passing it through the login flow.

The connection lasts up to eight hours, bounded by the Suite access token's expiry. Reopening the connector under the same Onshape site reuses the partitioned session. Expired sessions return to the connection screen. If a popup is blocked, the screen explains how to retry. If the browser rejects the embedded cookie, the screen reports that failure without navigating away from Onshape.

## Security contract

- `/auth/embed/authorize` requires the normal Suite cookie through the gateway and verified Shop identity. Embedded cookies cannot authorize this route. It emits only a one-use code, never a session token.
- The iframe creates a random 256-bit verifier. The popup code is bound to its SHA-256 challenge, expires after 60 seconds and can be redeemed once. Message receivers check both exact origin and popup window.
- Only `POST /auth/embed/exchange` is public. Shop requires the browser-facing Origin, JSON, the code and its matching verifier. Other methods, trailing slashes and subpaths retain ordinary authentication.
- The embedded cookie has a `__Host-` prefix, Path=/, Secure, HttpOnly, SameSite=None and Partitioned. It contains a copy of the signed Suite access token, without refresh credentials. The gateway revalidates every request, then Shop validates the injected workspace identity as usual.
- Gateway API failures return 401/403 rather than a login redirect. Failed iframe authentication clears identity before rendering the connection screen. Writes retain same-origin checks, including multipart releases.
- Signing out through Shop clears the cookie in the current browser partition. Signing out in another tab or partition does not revoke an already issued access token. It remains valid until expiry. This flow adds no server-side refresh or revocation mechanism.
- Only self and HTTPS Onshape subdomains may embed the connector. Onshape's iframe must permit popups and preserve the popup opener relationship. Live Onshape/Slack behavior still requires a production smoke test.

## Coordinated rollout

Suite owns the Caddy template and authentication overlay revision. Its companion changes are in the Caddy authentication template, the authentication Compose overlay and the authentication routing test script in the Hawk Suite repository. These extend the existing Shop identity integration; the older `deploy/hawk-suite-auth.patch` is historical and is not the embedded-session rollout patch.

Publish the tested Shop image and promote it through Suite's reviewed release process with the matching gateway changes. No new secret, public app port, database migration, Suite signing key or Onshape API call is required. Keep the app reachable only through the isolated gateway network.

After deployment, use a normal team member account to connect from an Onshape Part Studio, release a test part, reopen the connector, and reconnect after expiry. Check the supported browsers, including a configuration with third-party cookies blocked. Confirm Onshape allows the popup and Slack returns to the original opener. Automated fixtures cannot prove those third-party settings.

## Automated coverage

Shop's `tests/embedded-auth.test.ts` covers proof binding, expiry, replay prevention and cookie flags. Runtime tests exercise the actual popup/exchange routes, origin rejection, private responses, cookie clearing and denial of raw-cookie identity. `tests/embedded-browser.test.ts` exercises the browser popup, a real partitioned cookie under a cross-site Onshape-origin fixture, persistent connection and the real CAD release handler using cached fixture data. It does not contact Onshape or Slack.

Suite's the authentication routing test script runs the production template in disposable Caddy containers with synthetic signed JWTs. It verifies signature/expiry/issuer/audience/role checks, identity stripping, iframe recovery, exact public route matching and authenticated read/write routing.
