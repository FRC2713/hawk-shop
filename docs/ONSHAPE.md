# How Onshape behaves

This file lists the Onshape behavior Hawk Shop depends on, for anyone changing code that calls Onshape. Hawk Shop reaches Onshape with one server-side **API key pair**, never OAuth, so every entry here is about API-key access unless it says otherwise.

Each entry gives the fact, then a label, a source, and the code that relies on it:

- **documented**: Onshape's developer guide or its OpenAPI spec says so. The source is a link.
- **observed**: someone saw it in a real response. The source says when and how.
- **unverified**: the code assumes it, or another project reported it, and nobody has checked it with our key.

"Relied on by" names a module or function, not a path, so it survives file moves.

When you learn something about Onshape, add or correct the entry in the same PR as the code that relies on it. If Onshape proves an entry wrong, fix the entry and every module it lists.

Some entries come from [FRCDesignApp's ONSHAPE.md](https://github.com/frcdesign/FRCDesignApp/blob/main/docs/ONSHAPE.md). That app uses OAuth, so only facts that should hold for API keys are copied, and all of them stay **unverified** here until we see them ourselves.

**Every check against Onshape spends the team's annual allocation.** Tests mock `globalThis.fetch` and never call Onshape. Before making a real call to confirm an entry, get the go-ahead from whoever owns the key, and record what you saw here.

## Allocation and billing

- **The allowance is annual and set per plan.** EDU Enterprise gets 10,000 calls per enterprise per year. Other plans scale with users (Enterprise: 10,000 per full user; Professional: 5,000 per user; Free, Standard and EDU Student: 2,500 per user; EDU Educator, Pro and Discovery: 2,500 per company). Limits apply at the company level.
  - Label: documented
  - Source: [API Limits](https://onshape-public.github.io/docs/auth/limits/)
  - Relied on by: `withOnshapeCache` (why staleness is preferred to a miss), `partsTtlMs`, `VERSION_TTL_MS`

- **The company "Red Hawk Robotics" has a 10,000-request yearly limit.** On 2026-11-09 the developer portal showed 9,345 / 10,000 requests used (93.45%), day 309 of 365 in the billing cycle, and a tracking start date of Feb 19, 2026. The start date had a warning icon next to it; what that means is unknown.
  - Label: observed
  - Source: observed 2026-11-09, Onshape developer portal, Overview tab, "Annual API limits", viewed by a team admin
  - Relied on by: the cache's design assumptions; nothing reads the limit at runtime

- **A personal account has its own 2,500-request yearly limit and its own billing cycle.** The same portal view showed "My account (personal)" at 0 / 2,500 requests, day 66 of 365.
  - Label: observed
  - Source: observed 2026-11-09, same portal view
  - Relied on by: nothing in code

- **Which of those two allocations our API key's calls are billed to.** The key belongs to a user, and the [API Limits](https://onshape-public.github.io/docs/auth/limits/) page says keys created under My Account Settings belong to the user. The personal count of 0 suggests the company is paying, but nobody has checked which settings page the key was made in.
  - Label: unverified
  - Source: inference from the 2026-11-09 portal view
  - Relied on by: every reading of the portal numbers against `/api/onshape/usage`

- **The team's plan is EDU Enterprise.** The company-wide 10,000 matches that plan's row on the limits page, where adding users does not raise it.
  - Label: unverified
  - Source: team knowledge, consistent with the 2026-11-09 portal view; the plan name was not seen
  - Relied on by: the cache's design assumptions

- **Running out returns 402 Payment Required, not 429.** It is not a window to wait out: requests stay rejected until the allocation resets.
  - Label: documented
  - Source: [API Limits](https://onshape-public.github.io/docs/auth/limits/), [Response Codes](https://onshape-public.github.io/docs/api-adv/errors/)
  - Relied on by: `assertOnshapeAllocation` and `onshapeErrorResponse` in `auth.ts` (every route answers a 402 as "Onshape API allocation used up"); `recordOnshapeRemaining`, which records a 402 even without the header

- **Only 2xx and 3xx responses count.** API-key calls that return 4xx or 5xx are not charged.
  - Label: documented
  - Source: [API Limits](https://onshape-public.github.io/docs/auth/limits/)
  - Relied on by: `withOnshapeCache` (a throwing fetcher is not counted or cached), `recordOnshapeUsage`, the part-number release's response interceptor (counts `response.ok` only)

- **A followed 307 redirect is probably charged twice**: once for the 307 and once for the request to its destination, since 3xx counts. `recordOnshapeUsage` counts it once.
  - Label: unverified
  - Source: inferred from the rule above; never observed
  - Relied on by: nothing; the local tally may undercount if Onshape redirects often

- **Calls from Onshape's own browser and mobile clients don't count.** Students working in CAD do not spend the allocation; only API calls do.
  - Label: documented
  - Source: [API Limits](https://onshape-public.github.io/docs/auth/limits/)
  - Relied on by: nothing in code; it explains why Hawk Shop is the main spender

- **The developer portal is the only place to read the yearly count.** Its Overview tab shows one total per account, with no per-endpoint breakdown, and no API endpoint for it is known. The portal banner says all Onshape subscriptions have a yearly API limit and links to the limits docs.
  - Label: unverified (the totals were observed 2026-11-09; that no endpoint exists and no breakdown is offered elsewhere has not been checked)
  - Source: Onshape developer portal, Overview tab; [API Limits](https://onshape-public.github.io/docs/auth/limits/)
  - Relied on by: `onshape_api_usage` and `/api/onshape/usage`, which exist to answer "what is spending it"

- **Endpoints also have short-window rate limits that answer 429**, with `Retry-After` giving the seconds until that endpoint's counter resets. Onshape doesn't publish the limits and says they can change.
  - Label: documented
  - Source: [Response Codes](https://onshape-public.github.io/docs/api-adv/errors/), [API Limits](https://onshape-public.github.io/docs/auth/limits/)
  - Relied on by: nothing yet; no code retries a 429

- **`Retry-After` is sometimes missing from a 429.**
  - Label: unverified
  - Source: FRCDesignApp ONSHAPE.md (seen with OAuth)
  - Relied on by: nothing yet

### Remaining-calls header

- **Every response carries `X-Rate-Limit-Remaining`, the number of calls left to that endpoint in the current window.** Onshape describes it as a per-endpoint, per-window count, not the annual allocation.
  - Label: documented
  - Source: [Response Codes](https://onshape-public.github.io/docs/api-adv/errors/), the 429 section
  - Relied on by: `onshapeFetch`, which hands each final (non-3xx) response to `recordOnshapeRemaining`; `endpointFamily`, which keys the stored value per endpoint

- **With our API key, `GET /api/v6/users/sessioninfo` returned `x-rate-limit-remaining: 3000`.**
  - Label: observed
  - Source: observed 2026-11-09 13:55 UTC: one approved call with the team's API key (Basic auth, `access:secret`), HTTP 200
  - Relied on by: the `/onshape` page wording and `/api/onshape/usage` `remaining`

- **The header is not the annual allocation remaining.** On the same day the portal showed the company with 655 requests left (9,345 / 10,000) and the personal account with 2,500 left. The header's 3000 matches neither.
  - Label: observed
  - Source: observed 2026-11-09, the `sessioninfo` call above compared with the developer portal's "Annual API limits" overview
  - Relied on by: the `/onshape` page wording and `/api/onshape/usage` `remaining`

- **What the header does count is not settled.** It matches FRCDesignApp's figure of about 3,000 for one endpoint group (about 9,000 for the others, under OAuth), which points to a per-endpoint or per-window bucket, as the Response Codes page describes. Whether it goes down by one per call, whether endpoints share it, and when it resets have not been seen.
  - Label: unverified
  - Source: FRCDesignApp ONSHAPE.md; [Response Codes](https://onshape-public.github.io/docs/api-adv/errors/)
  - Relied on by: the UI wording rule below
  - TODO: record a second reading on the same endpoint and one on a different endpoint (for example the parts list) to see whether the count goes down per call and whether endpoints share it.

  So:
  - The UI says "Onshape reports N calls remaining" and never presents it as annual ("left this year", "of 10,000"). The yearly number comes only from the developer portal.
  - Store the value per endpoint family (`endpointFamily`: `parts`, `documents`, `thumbnails`, `metadata`, …), not as one global number, since different endpoints may report different buckets.

- **`X-Rate-Limit-Remaining` is the only rate-limit header.** Nothing names the limit or when it resets.
  - Label: unverified
  - Source: FRCDesignApp ONSHAPE.md (seen with OAuth)
  - Relied on by: `recordOnshapeRemaining`, which reads only this header

## Authentication and signing

- **Requests are signed with HMAC-SHA256.** The canonical string is method, `On-Nonce`, `Date`, `Content-Type`, URL path and query string, each followed by a newline and the whole string lowercased. The signature is the Base64 digest, sent as `Authorization: On <accessKey>:HmacSHA256:<signature>`.
  - Label: documented
  - Source: [API Keys](https://onshape-public.github.io/docs/auth/apikeys/)
  - Relied on by: `signedOnshapeHeaders`

- **The nonce must be at least 16 alphanumeric characters and unique per request; `Date` must be within 5 minutes of Onshape's clock.** We send 40 hex characters. A server with a drifting clock gets 401s.
  - Label: documented
  - Source: [API Keys](https://onshape-public.github.io/docs/auth/apikeys/)
  - Relied on by: `signedOnshapeHeaders`

- **The same key pair also works as HTTP Basic auth (`access:secret`).**
  - Label: observed
  - Source: observed 2026-11-09, the `sessioninfo` call above returned 200
  - Relied on by: nothing; the app always signs. Useful for one-off manual checks.

- **Some endpoints answer 307, and the redirected request needs its own `Authorization` header.** The server part of the URL can differ from the original.
  - Label: documented
  - Source: [API Keys](https://onshape-public.github.io/docs/auth/apikeys/), [Response Codes](https://onshape-public.github.io/docs/api-adv/errors/)
  - Relied on by: `onshapeFetch` (manual redirects, re-signs each hop, at most 5, only to `*.onshape.com`)

- **Onshape may answer 308 as well as 307.** `onshapeFetch` accepts both and rejects every other 3xx.
  - Label: unverified
  - Source: defensive assumption in `onshapeFetch`
  - Relied on by: `onshapeFetch`

- **Redirects and thumbnail hrefs only ever point at `*.onshape.com` over HTTPS.**
  - Label: unverified
  - Source: assumption behind the host allowlist
  - Relied on by: `isOnshapeUrl`, `onshapeFetch`, the thumbnail route's `?url=` form

- **A key belongs to the Onshape user who created it and works only on the stack it was created on.** A key from a company stack (`company.onshape.com`) fails on `cad.onshape.com`, and the reverse.
  - Label: documented
  - Source: [API Keys](https://onshape-public.github.io/docs/auth/apikeys/)
  - Relied on by: `onshapeOrigin` and `ONSHAPE_BASE_URL`; every CAD read and write runs with that user's document permissions

## Documents, workspaces, versions and microversions

- **Paths name a document, then a workspace (`w`), version (`v`) or microversion (`m`) and its id, then an element.** Writes always go to a workspace, because versions and microversions are immutable. Every edit creates a new microversion.
  - Label: documented
  - Source: [API Guide introduction](https://onshape-public.github.io/docs/api-intro/)
  - Relied on by: `partsTtlMs` (parts at `v` or `m` are cached with no expiry), `fetchPartsFromOnshape`, `handlePartNumberUpdate` (defaults to `w`)

- **A version's name can be edited after it is cut**, even though its contents can't.
  - Label: unverified
  - Source: assumption in `VERSION_TTL_MS`
  - Relied on by: `VERSION_TTL_MS` (one week rather than never)

## Parts and metadata

- **The Part Studio parts list takes `withThumbnails`, which is not supported at a microversion.**
  - Label: documented
  - Source: Onshape OpenAPI spec, `getPartsWMVE` (`src/lib/onshapeApi/generated/types.gen.ts`)
  - Relied on by: `fetchPartsFromOnshape` (asks for thumbnails at every `wvm`)

- **Each part in the parts list carries a `microversionId`.**
  - Label: documented
  - Source: Onshape OpenAPI spec, `BTPartMetadataInfo.microversionId` (`src/lib/onshapeApi/generated/types.gen.ts`)
  - Relied on by: `syncWorkspaceCardMicroversions`, the release action (`onshape_microversion_id`), `partCacheKey`

- **A part's `microversionId` changes when that part changes and only then;** edits to other parts in the same Part Studio leave it alone.
  - Label: unverified
  - Source: #48 and FRCDesignApp's microversion-keyed caching (seen with OAuth)
  - Relied on by: `partCacheKey`, the thumbnail route's microversion-keyed rows. If it changed on every Part Studio edit, thumbnails would refetch more often than needed but never go stale; if it failed to change on a geometry edit, cards would keep the old picture.

- **The parts list is either a bare array or `{ parts: [...] }`.**
  - Label: unverified
  - Source: defensive handling in the hand-written `OnshapeClient.getParts`
  - Relied on by: `OnshapeClient.getParts`

- **Part metadata is read with `getWMVEPMetadata` and written with a body of `jsonType: "metadata-part"` and a `properties` array of `{ propertyId, value }`.** The part-number property is found by name ("Part number") in the read.
  - Label: documented
  - Source: [Metadata](https://onshape-public.github.io/docs/api-adv/metadata/)
  - Relied on by: `handlePartNumberUpdate`

- **The part-number property can also be recognized by a `propertyId` containing `partnumber` or `part_number`.**
  - Label: unverified
  - Source: fallback in `isPartNumberProperty`
  - Relied on by: `handlePartNumberUpdate`

- **The OpenAPI spec types the metadata write body as a string, but Onshape expects the JSON object.** Pre-serializing it encodes it twice.
  - Label: unverified
  - Source: comment in `handlePartNumberUpdate`; no dated observation
  - Relied on by: `handlePartNumberUpdate`

- **Reading metadata with computed properties is slow.**
  - Label: unverified
  - Source: FRCDesignApp ONSHAPE.md (seen with OAuth)
  - Relied on by: nothing; worth knowing before calling it per part

## Thumbnails

Onshape's developer guide has no thumbnails page; the endpoints are only in the OpenAPI spec.

- **Part thumbnails are fetched from `/api/v10/thumbnails/d/{did}/{wvm}/{wvmid}/e/{eid}/p/{pid}?outputFormat=PNG&pixelSize=300`.** That part-level path is not in the OpenAPI spec the generated client was built from, which lists element and document thumbnails only.
  - Label: unverified
  - Source: URL built by `uploadOnshapeThumbnail` and the connector's release action
  - Relied on by: `uploadOnshapeThumbnail`, the release action's fallback thumbnail URL

- **The thumbnail hrefs in the parts list point at `*.onshape.com` and need a signed request.**
  - Label: unverified
  - Source: assumption behind the thumbnail route's `?url=` form
  - Relied on by: `/api/onshape/thumbnail`

- **A thumbnail fetch counts against the allocation like any other API call.** It follows from "API-key calls that return 2xx or 3xx count", but no one has seen it on Onshape's usage page. #55 records observations here.
  - Label: unverified
  - Source: inferred from [API Limits](https://onshape-public.github.io/docs/auth/limits/)
  - Relied on by: the shared `part_thumbnails` cache keyed by source URL, `recordOnshapeUsage("thumbnail", …)`

- **A thumbnail at a fixed version never changes,** so one stored copy per source URL is safe to keep forever.
  - Label: unverified
  - Source: assumption in the thumbnail route
  - Relied on by: `/api/onshape/thumbnail`, `deleteCardImage` (leaves `thumbnails/` alone because cards share them)

- **A workspace thumbnail URL stays the same when the part's geometry changes,** so caching by URL alone serves the old shape after an edit. That is why thumbnails are now keyed by the part's microversion when the caller knows it.
  - Label: unverified
  - Source: #48 problem statement; follows from the URL naming the workspace, not a microversion
  - Relied on by: `/api/onshape/thumbnail` (`findStoredThumbnail`)

- **A thumbnail that is still rendering answers 406 to `Accept: image/*` and 404 to `*/*`.** Our signer sends `Accept: application/json` unless the caller sets one, which thumbnail fetches don't.
  - Label: unverified
  - Source: FRCDesignApp ONSHAPE.md (seen with OAuth)
  - Relied on by: nothing yet; relevant to #55

- **The version form of the element thumbnail endpoint is unreliable; the workspace form is reliable.**
  - Label: unverified
  - Source: FRCDesignApp ONSHAPE.md (seen with OAuth)
  - Relied on by: nothing yet; relevant to #55

Not Onshape behavior, but often mistaken for it: card `image_url` values written by older releases are Hawk Shop proxy URLs (`/api/onshape/thumbnail?url=<onshape url>`). The thumbnail route unwraps them to the real Onshape URL before looking up the cache.

## Webhooks

Hawk Shop can receive webhooks but doesn't register any yet (#58). `POST /api/onshape/webhook` clears a document's cached workspace (`wvm=w`) reads when Onshape reports a change, so the next connector read sees the edit instead of waiting out `ONSHAPE_CACHE_TTL_SECONDS`.

How the receiver behaves (Hawk Shop's own contract, covered by `tests/onshape-webhook.test.ts` and `tests/runtime.test.ts`):

- Enabled only when `ONSHAPE_WEBHOOK_SECRET` and `ONSHAPE_WEBHOOK_BASE_URL` are both set (`onshapeWebhookSettings`). Otherwise every request gets 404.
- The callback URL is `<ONSHAPE_WEBHOOK_BASE_URL>/api/onshape/webhook?secret=<ONSHAPE_WEBHOOK_SECRET>` (`onshapeWebhookCallbackUrl`). The secret is compared in constant time (`isOnshapeWebhookSecret`). A missing or wrong secret gets the same empty 404 as a disabled route.
- With the right secret every delivery gets an empty 200, even one it ignores, because a non-200 cancels a new registration. `onshape.model.lifecycle.changed`, `onshape.model.lifecycle.createversion` and `onshape.model.lifecycle.metadata` run `invalidateOnshapeCacheForDocument(documentId)` inline. It deletes that document's workspace rows and drops their in-flight reads. Version and microversion entries and other documents stay cached. Other events, including `webhook.register`, change nothing.
- No debounce. Invalidation is idempotent, and single-flight collapses the reads that follow a burst into one upstream call.
- The middleware exempts exactly `POST /api/onshape/webhook` from Suite identity and the same-origin check. A trailing slash, subpath, neighbouring path or other method still needs identity. The response carries no shop data.

**Gateway route.** The Suite gateway authorizes every Shop request, so Onshape's deliveries never reach the app until the gateway forwards this one path without `authorize`. In the Shop site block of the Suite Caddyfile (see `deploy/hawk-suite-auth.patch`), add this before the catch-all `handle`, after `import clear-suite-identity`:

```caddy
@shop-onshape-webhook {
    method POST
    path /api/onshape/webhook
}
handle @shop-onshape-webhook {
    reverse_proxy hawk-shop:3000
}
```

Caddy's `path` matcher without a `*` is exact, so `/api/onshape/webhook/` and subpaths still go through `authorize`. Identity headers are already cleared, so the app sees an anonymous request. Set `ONSHAPE_WEBHOOK_BASE_URL` to the public origin of that site (for example `https://shop.<domain>`). `deploy/hawk-suite-auth.patch` doesn't include this route yet; add it, with a routing check, when webhooks are turned on.

- **Webhooks are registered with `POST /api/v6/webhooks`.** Onshape immediately sends a `webhook.register` notification, and if the endpoint doesn't answer 200 the registration is cancelled. HTTPS endpoints need a certificate from a recognized CA.
  - Label: documented
  - Source: [Webhooks](https://onshape-public.github.io/docs/app-dev/webhook/)
  - Relied on by: the webhook route (answers 200 to every authenticated delivery); registration is #58

- **The endpoint must be one Onshape can call.** Hawk Shop sits behind the Suite gateway, so the webhook route needs a public path that bypasses Suite sign-in.
  - Label: documented
  - Source: [Webhooks](https://onshape-public.github.io/docs/app-dev/webhook/)
  - Relied on by: the middleware exemption and the gateway route above

- **Deliveries are JSON bodies with `event` and `documentId` fields** (also `workspaceId`, `webhookId`, `messageId`, `timestamp`).
  - Label: unverified
  - Source: example notifications on the [Webhooks](https://onshape-public.github.io/docs/app-dev/webhook/) page; no delivery has been seen with our key
  - Relied on by: the webhook route

- **Onshape keeps the callback URL's query string when it delivers**, so the secret arrives with every notification.
  - Label: unverified
  - Source: FRCDesignApp puts its token in the URL the same way (seen with OAuth)
  - Relied on by: `isOnshapeWebhookSecret`, `onshapeWebhookCallbackUrl`

- **`onshape.model.lifecycle.metadata` fires when part properties such as the part number change.**
  - Label: unverified
  - Source: event name in Onshape's webhook event list; not seen with our key
  - Relied on by: the webhook route's handled-events list

- **Webhooks are transient by default and are deleted after a period without events** unless registered with `isTransient: false`. Onshape keeps delivering until the endpoint errors or stops responding for a long time.
  - Label: documented
  - Source: [Webhooks](https://onshape-public.github.io/docs/app-dev/webhook/)
  - Relied on by: nothing yet

- **`onshape.model.lifecycle.changed` fires on workspace edits and `onshape.model.lifecycle.createversion` when a version is cut.**
  - Label: documented
  - Source: [Webhooks](https://onshape-public.github.io/docs/app-dev/webhook/) (event names in its examples)
  - Relied on by: the webhook route's handled-events list (`ONSHAPE_DOCUMENT_CHANGE_EVENTS`)

- **Whether webhook deliveries or registrations count against the allocation.**
  - Label: unverified
  - Source: not stated on the Webhooks page
  - Relied on by: nothing yet

- **Deliveries are not signed**, so a webhook URL needs its own secret token.
  - Label: unverified
  - Source: FRCDesignApp ONSHAPE.md (seen with OAuth)
  - Relied on by: `isOnshapeWebhookSecret` (the secret in the callback URL is the only check)

## Errors

- **Status codes:** 401 means authentication failed, including a key for a different stack. 403 means the key or document permissions don't allow the operation, for example a read-only key on a POST. 404 means the resource doesn't exist. 402 and 429 are covered under [Allocation and billing](#allocation-and-billing).
  - Label: documented
  - Source: [Response Codes](https://onshape-public.github.io/docs/api-adv/errors/)
  - Relied on by: `createErrorResponse` (part-number release), the parts and version routes' error mapping

- **A version that can't be read usually means a credentials problem rather than a missing version**, so the version route never caches a miss.
  - Label: unverified
  - Source: comment in the version route
  - Relied on by: `/api/onshape/version`

- **Error bodies carry the message in `message`, `error` or `errorMessage`.**
  - Label: unverified
  - Source: defensive handling in `OnshapeClient`
  - Relied on by: `OnshapeClient`

Hawk Shop's own codes are separate: a missing key pair returns 409 from Hawk Shop (`OnshapeConfigurationError`), and a Suite sign-in failure returns 401. Neither comes from Onshape.
