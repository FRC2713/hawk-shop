import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
const route = await import("../src/pages/api/slack/interactions");
const { isSlackSignature } = await import("../src/server/slack-interactions");

const secret = "fixture-signing-secret";
function signed(
  body: string,
  at = Math.floor(Date.now() / 1000),
  key = secret
) {
  const signature =
    "v0=" + createHmac("sha256", key).update(`v0:${at}:${body}`).digest("hex");
  return new Request("http://localhost/api/slack/interactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Slack-Request-Timestamp": String(at),
      "X-Slack-Signature": signature,
    },
    body,
  });
}
const call = (request: Request) =>
  (route.POST as (context: { request: Request }) => Promise<Response>)({
    request,
  });
const body = "payload=" + encodeURIComponent('{"type":"block_actions"}');

test("without a signing secret the route does not exist", async () => {
  delete process.env.SLACK_SIGNING_SECRET;
  assert.equal((await call(signed(body))).status, 404);
});

test("a signed click is acknowledged with an empty body", async () => {
  process.env.SLACK_SIGNING_SECRET = secret;
  const response = await call(signed(body));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});

test("wrong secrets, replays and missing headers are refused", async () => {
  process.env.SLACK_SIGNING_SECRET = secret;
  assert.equal((await call(signed(body, undefined, "other"))).status, 401);
  const stale = Math.floor(Date.now() / 1000) - 6 * 60;
  assert.equal((await call(signed(body, stale))).status, 401);
  const unsigned = new Request("http://localhost/api/slack/interactions", {
    method: "POST",
    body,
  });
  assert.equal((await call(unsigned)).status, 401);
  assert.equal(isSlackSignature(secret, "12x", "v0=00", body), false);
  const tampered = signed(body);
  const altered = new Request(tampered, { body: body + "&x=1" });
  assert.equal((await call(altered)).status, 401);
});
