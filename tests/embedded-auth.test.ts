import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  embeddedCookie,
  issueEmbeddedCode,
  redeemEmbeddedCode,
} from "../src/server/embedded-auth";

const verifier = () => randomBytes(32).toString("base64url");
const challenge = (value: string) =>
  createHash("sha256").update(value).digest("base64url");

test("popup codes require the iframe's proof, expire, and redeem once", (t) => {
  const proof = verifier();
  const code = issueEmbeddedCode(challenge(proof), "fixture-suite-token");
  assert.equal(redeemEmbeddedCode(code, verifier()), undefined);
  assert.equal(redeemEmbeddedCode(null, proof), undefined);
  assert.equal(redeemEmbeddedCode(code, {}), undefined);
  assert.equal(redeemEmbeddedCode(code, proof), "fixture-suite-token");
  assert.equal(redeemEmbeddedCode(code, proof), undefined);
  const expired = issueEmbeddedCode(challenge(proof), "expired-token");
  t.mock.method(Date, "now", () => 10 ** 15);
  assert.equal(redeemEmbeddedCode(expired, proof), undefined);
});

test("embedded cookies are host-only, HttpOnly, secure and partitioned", () => {
  const cookie = embeddedCookie("fixture-token");
  assert.match(cookie, /^__Host-hawk-shop-embedded=fixture-token;/);
  for (const flag of [
    "Path=/",
    "Secure",
    "HttpOnly",
    "SameSite=None",
    "Partitioned",
    "Max-Age=28800",
  ])
    assert.ok(cookie.includes(flag), flag);
  assert.ok(!cookie.includes("Domain="));
  assert.match(embeddedCookie("", 0), /Max-Age=0/);
});
