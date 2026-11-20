import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const directory = mkdtempSync(path.join(tmpdir(), "hawk-shop-oauth-"));
Object.assign(process.env, {
  DATA_DIR: directory,
  APP_URL: "https://shop.suite.test",
  MCP_OAUTH_ENABLED: "true",
  HAWK_SUITE_TRUST_PROXY: "true",
  HAWK_SUITE_TEAM_ID: "TRHR",
  HAWK_SUITE_ISSUER: "https://apps.suite.test/",
});
const { db } = await import("../src/server/db/client");
const {
  register,
  token,
  revoke,
  protectedResourceMetadata,
  authorizationServerMetadata,
} = await import("../src/server/oauth/handlers");
const { startAuthorization, finishAuthorization } =
  await import("../src/server/oauth/authorize");
const {
  disconnect,
  listConnections,
  principalForAccessToken,
  revokeGrants,
  sweep,
  takeRateToken,
} = await import("../src/server/oauth/store");
const { validRedirectUri, redirectMatches } =
  await import("../src/server/oauth/redirect-uris");
const { GRANT_TTL, ACCESS_TTL } = await import("../src/server/oauth/settings");
const { upsertUser } = await import("../src/server/db/users");
const member = "slack:TRHR:UALICE";
await upsertUser(member, "Alice");
after(() => rmSync(directory, { recursive: true, force: true }));
const base = process.env.APP_URL!;
const callback = "http://127.0.0.1:34567/callback";
const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
};
const form = (values: Record<string, string>) =>
  new Request(`${base}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
async function client(redirects = [callback]) {
  const response = await register(
    new Request(`${base}/oauth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": randomBytes(6).toString("hex"),
      },
      body: JSON.stringify({
        client_name: "Unverified test app",
        redirect_uris: redirects,
      }),
    })
  );
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).client_id as string;
}
function params(
  clientId: string,
  challenge: string,
  extra: Record<string, string> = {}
) {
  return new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: callback,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${base}/mcp`,
    state: "original-state",
    ...extra,
  });
}
async function pending(scope?: string, now = Date.now()) {
  const clientId = await client();
  const { verifier, challenge } = pkce();
  const view = startAuthorization(
    params(clientId, challenge, scope ? { scope } : {}),
    member,
    now
  );
  assert.equal(view.kind, "consent");
  if (view.kind !== "consent") throw new Error("Expected consent");
  return { clientId, verifier, view, now };
}
async function connect(scope?: string, now = Date.now()) {
  const auth = await pending(scope, now);
  const location = new URL(
    finishAuthorization(auth.view.requestId, member, true, now)!
  );
  assert.equal(location.searchParams.get("state"), "original-state");
  assert.equal(location.searchParams.get("iss"), base);
  const code = location.searchParams.get("code")!;
  const response = await token(
    form({
      grant_type: "authorization_code",
      client_id: auth.clientId,
      redirect_uri: callback,
      code,
      code_verifier: auth.verifier,
      resource: `${base}/mcp`,
    }),
    now
  );
  assert.equal(response.status, 200, await response.clone().text());
  return { ...auth, code, tokens: await response.json() };
}
const refresh = (
  clientId: string,
  refreshToken: string,
  extra: Record<string, string> = {},
  now = Date.now()
) =>
  token(
    form({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
      ...extra,
    }),
    now
  );

test("OAuth metadata matches Eye's configuration and advertises Shop scopes", async () => {
  assert.deepEqual(
    (await protectedResourceMetadata().json()).scopes_supported,
    ["shop:read", "shop:manage"]
  );
  const metadata = await authorizationServerMetadata().json();
  assert.equal(metadata.issuer, base);
  assert.equal(metadata.authorization_endpoint, `${base}/oauth/authorize`);
  assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ["none"]);
  process.env.MCP_OAUTH_ENABLED = "false";
  assert.equal(protectedResourceMetadata().status, 404);
  process.env.MCP_OAUTH_ENABLED = "true";
  process.env.HAWK_SUITE_TRUST_PROXY = "false";
  assert.equal(protectedResourceMetadata().status, 503);
  process.env.HAWK_SUITE_TRUST_PROXY = "true";
});

test("registration permits HTTPS and loopback redirects only, matching exact paths", async () => {
  for (const invalid of [
    "http://outside.example/callback",
    "https://user:pass@client.example/callback",
    "myapp://callback",
    "https://client.example/cb#fragment",
  ])
    assert.equal(validRedirectUri(invalid), false);
  assert.ok(validRedirectUri(callback));
  assert.ok(validRedirectUri("https://client.example/cb"));
  assert.ok(redirectMatches([callback], "http://127.0.0.1:54321/callback"));
  assert.ok(!redirectMatches([callback], "http://localhost:34567/callback"));
  assert.ok(!redirectMatches([callback], "http://127.0.0.1:54321/other"));
  const response = await register(
    new Request(`${base}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["http://outside.example"] }),
    })
  );
  assert.equal(response.status, 400);
});

test("authorization validates client, callback, PKCE, scope, resource and repeated parameters", async () => {
  const clientId = await client();
  const invalidClients: Record<string, string>[] = [
    { client_id: "unknown" },
    { redirect_uri: "https://attacker.example/cb" },
  ];
  for (const extra of invalidClients)
    assert.equal(
      startAuthorization(params(clientId, pkce().challenge, extra), member)
        .kind,
      "error"
    );
  for (const [extra, expected] of [
    [{ code_challenge_method: "plain" }, "invalid_request"],
    [{ response_type: "token" }, "unsupported_response_type"],
    [{ resource: "https://eye.suite.test/mcp" }, "invalid_target"],
    [{ scope: "shop:read admin" }, "invalid_scope"],
  ] as const) {
    const view = startAuthorization(
      params(clientId, pkce().challenge, extra),
      member
    );
    assert.equal(view.kind, "redirect");
    if (view.kind === "redirect")
      assert.equal(new URL(view.location).searchParams.get("error"), expected);
  }
  const duplicate = params(clientId, pkce().challenge);
  duplicate.append("client_id", clientId);
  assert.equal(startAuthorization(duplicate, member).kind, "error");
});

test("consent is subject-bound, expires and can be denied only once", async () => {
  const auth = await pending();
  assert.equal(
    finishAuthorization(auth.view.requestId, "slack:TRHR:UBOB", true),
    undefined
  );
  const denied = new URL(
    finishAuthorization(auth.view.requestId, member, false)!
  );
  assert.equal(denied.searchParams.get("error"), "access_denied");
  assert.equal(
    finishAuthorization(auth.view.requestId, member, true),
    undefined
  );
  const expired = await pending();
  assert.equal(
    finishAuthorization(
      expired.view.requestId,
      member,
      true,
      expired.now + 600001
    ),
    undefined
  );
});

test("OAuth tokens are hashed, scope-limited and accompanied by ISO expiry and audit rows", async () => {
  const { tokens, clientId } = await connect("shop:read");
  assert.equal(tokens.scope, "shop:read");
  assert.equal(tokens.expires_in, 3600);
  assert.match(tokens.access_token, /^hsk_at_[A-Za-z0-9_-]{43}$/);
  const principal = principalForAccessToken(tokens.access_token, Date.now())!;
  assert.equal(principal.subject, member);
  assert.deepEqual(principal.scope, ["shop:read"]);
  const rows = db.$client
    .prepare("SELECT token_hash,expires_at FROM oauth_tokens WHERE grant_id=?")
    .all(principal.grantId) as { token_hash: string; expires_at: string }[];
  assert.ok(
    rows.every(
      (row) =>
        /^[a-f0-9]{64}$/.test(row.token_hash) && row.expires_at.endsWith("Z")
    )
  );
  assert.ok(
    rows.every(
      (row) =>
        ![tokens.access_token, tokens.refresh_token].includes(row.token_hash)
    )
  );
  const audit = db.$client
    .prepare(
      "SELECT event,subject FROM oauth_audit WHERE client_id=? ORDER BY id"
    )
    .all(clientId);
  assert.deepEqual(audit, [
    { event: "grant_created", subject: member },
    { event: "tokens_issued", subject: member },
  ]);
  assert.equal(
    principalForAccessToken(tokens.access_token, Date.now() + ACCESS_TTL + 1),
    undefined
  );
});

test("code exchange enforces verifier, callback and single use; replay revokes access", async () => {
  for (const overrides of [
    { code_verifier: pkce().verifier },
    { redirect_uri: "http://127.0.0.1:1/other" },
  ]) {
    const auth = await pending();
    const code = new URL(
      finishAuthorization(auth.view.requestId, member, true)!
    ).searchParams.get("code")!;
    const response = await token(
      form({
        grant_type: "authorization_code",
        client_id: auth.clientId,
        redirect_uri: callback,
        code,
        code_verifier: auth.verifier,
        ...overrides,
      })
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_grant");
  }
  const connected = await connect();
  const replay = await token(
    form({
      grant_type: "authorization_code",
      client_id: connected.clientId,
      redirect_uri: callback,
      code: connected.code,
      code_verifier: connected.verifier,
    })
  );
  assert.equal(replay.status, 400);
  assert.equal(
    principalForAccessToken(connected.tokens.access_token, Date.now()),
    undefined
  );
});

test("refresh rotation detects replay, forbids scope escalation and ends after seven days", async () => {
  const connected = await connect("shop:read");
  const escalation = await refresh(
    connected.clientId,
    connected.tokens.refresh_token,
    { scope: "shop:read shop:manage" }
  );
  assert.equal(escalation.status, 400);
  const rotatedResponse = await refresh(
    connected.clientId,
    connected.tokens.refresh_token
  );
  assert.equal(rotatedResponse.status, 200);
  const rotated = await rotatedResponse.json();
  assert.notEqual(rotated.refresh_token, connected.tokens.refresh_token);
  assert.ok(principalForAccessToken(rotated.access_token, Date.now()));
  assert.equal(
    (await refresh(connected.clientId, connected.tokens.refresh_token)).status,
    400
  );
  assert.equal(
    principalForAccessToken(rotated.access_token, Date.now()),
    undefined
  );
  const expired = await connect();
  assert.equal(
    (
      await refresh(
        expired.clientId,
        expired.tokens.refresh_token,
        {},
        expired.now + GRANT_TTL + 1
      )
    ).status,
    400
  );
});

test("connections can be revoked by their member, client or operator", async () => {
  const connected = await connect();
  const grantId = principalForAccessToken(
    connected.tokens.access_token,
    Date.now()
  )!.grantId;
  assert.ok(
    listConnections(member, Date.now()).some((c) => c.grantId === grantId)
  );
  assert.equal(disconnect(grantId, "slack:TRHR:UBOB", Date.now()), false);
  assert.equal(disconnect(grantId, member, Date.now()), true);
  assert.equal(
    principalForAccessToken(connected.tokens.access_token, Date.now()),
    undefined
  );
  const byClient = await connect();
  assert.equal(
    (
      await revoke(
        form({
          client_id: byClient.clientId,
          token: byClient.tokens.refresh_token,
        })
      )
    ).status,
    200
  );
  assert.equal(
    principalForAccessToken(byClient.tokens.access_token, Date.now()),
    undefined
  );
  const byOperator = await connect();
  assert.ok(revokeGrants(member, Date.now()) > 0);
  assert.equal(
    principalForAccessToken(byOperator.tokens.access_token, Date.now()),
    undefined
  );
});

test("public request limits and cleanup preserve used-code replay detection", async () => {
  const connected = await connect();
  assert.equal(takeRateToken("test-bucket", 1, 1000, connected.now), true);
  assert.equal(takeRateToken("test-bucket", 1, 1000, connected.now), false);
  assert.equal(
    takeRateToken("test-bucket", 1, 1000, connected.now + 1000),
    true
  );
  sweep(connected.now + 120000);
  const replay = await token(
    form({
      grant_type: "authorization_code",
      client_id: connected.clientId,
      redirect_uri: callback,
      code: connected.code,
      code_verifier: connected.verifier,
    }),
    connected.now + 120000
  );
  assert.equal(replay.status, 400);
  assert.equal(
    principalForAccessToken(connected.tokens.access_token, Date.now()),
    undefined
  );
});

test("production-compatible operator command revokes persisted connections", async () => {
  const connected = await connect();
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["scripts/oauth-revoke.mjs", "--subject", member],
    { env: process.env }
  );
  assert.match(stdout, /Revoked [1-9]/);
  assert.equal(
    principalForAccessToken(connected.tokens.access_token, Date.now()),
    undefined
  );
});
