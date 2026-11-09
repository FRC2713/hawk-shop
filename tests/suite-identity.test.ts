import { test } from "node:test";
import assert from "node:assert/strict";
import { readSuiteHeaders, suiteIdentity } from "../src/server/suite-identity";

const member = {
  "x-token-subject": "slack:TTEAM:UMEMBER",
  "x-hawk-slack-team": "TTEAM",
  "x-hawk-slack-user": "UMEMBER",
  "x-token-user-roles": "authp/user suite/member",
  "x-token-user-name": "Shop Member",
};

test("Suite identity requires a matching workspace, subject, user and member role", () => {
  assert.equal(
    readSuiteHeaders(new Headers(member), "TTEAM")?.subject,
    member["x-token-subject"]
  );
  for (const field of Object.keys(member).filter(
    (field) => field !== "x-token-user-name"
  )) {
    const headers = new Headers(member);
    headers.delete(field);
    assert.equal(readSuiteHeaders(headers, "TTEAM"), undefined, field);
  }
  for (const [field, value] of [
    ["x-hawk-slack-team", "TOTHER"],
    ["x-hawk-slack-user", "not-slack"],
    ["x-token-subject", "slack:TTEAM:UOTHER"],
    ["x-token-user-roles", "suite/admin"],
    ["x-token-user-roles", "suite/membership"],
    ["x-token-user-roles", "suite/member,suite/member"],
  ]) {
    assert.equal(
      readSuiteHeaders(new Headers({ ...member, [field]: value }), "TTEAM"),
      undefined
    );
  }
  const duplicate = new Headers(member);
  duplicate.append("x-token-subject", member["x-token-subject"]);
  assert.equal(readSuiteHeaders(duplicate, "TTEAM"), undefined);
});

test("proxy identity headers grant nothing unless proxy trust is explicitly enabled", () => {
  const before = process.env.HAWK_SUITE_TRUST_PROXY;
  process.env.HAWK_SUITE_TRUST_PROXY = "false";
  try {
    assert.equal(
      suiteIdentity(new Request("http://localhost", { headers: member })),
      undefined
    );
  } finally {
    if (before === undefined) delete process.env.HAWK_SUITE_TRUST_PROXY;
    else process.env.HAWK_SUITE_TRUST_PROXY = before;
  }
});
