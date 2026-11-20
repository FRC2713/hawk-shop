import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { once } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

test(
  "built OAuth connection flow covers discovery, consent, MCP, refresh and disconnect",
  {
    skip: process.env.HAWK_SHOP_VERIFY_BUILT_SERVER !== "1",
  },
  async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "hawk-mcp-runtime-"));
    const reservation = createServer();
    await new Promise<void>((resolve) =>
      reservation.listen(0, "127.0.0.1", resolve)
    );
    const address = reservation.address();
    assert.ok(address && typeof address !== "string");
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const local = `http://127.0.0.1:${address.port}`;
    const origin = "https://shop.suite.test";
    const child = fork(path.resolve("dist/server/entry.mjs"), [], {
      env: {
        ...process.env,
        DATA_DIR: directory,
        HOST: "127.0.0.1",
        PORT: String(address.port),
        APP_URL: origin,
        MCP_OAUTH_ENABLED: "true",
        HAWK_SUITE_TRUST_PROXY: "true",
        HAWK_SUITE_TEAM_ID: "TRHR",
        HAWK_SUITE_ISSUER: "https://apps.suite.test/",
        SLACK_BOT_TOKEN: "",
        ONSHAPE_ACCESS_KEY: "",
        ONSHAPE_SECRET_KEY: "",
      },
      execArgv: [],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    const identity = {
      "X-Token-Subject": "slack:TRHR:UALICE",
      "X-Hawk-Slack-Team": "TRHR",
      "X-Hawk-Slack-User": "UALICE",
      "X-Token-User-Roles": "suite/member",
      "X-Token-User-Name": "Alice",
    };
    let output = "";
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Server did not start: ${output}`)),
          20000
        );
        const check = (chunk: Buffer) => {
          output += chunk;
          if (output.includes("Server listening")) {
            clearTimeout(timer);
            resolve();
          }
        };
        child.stdout!.on("data", check);
        child.stderr!.on("data", check);
        child.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`Server exited ${code}: ${output}`));
        });
      });
      const anonymous = await fetch(`${local}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal(anonymous.status, 401);
      assert.match(
        anonymous.headers.get("www-authenticate")!,
        /oauth-protected-resource\/mcp/
      );
      for (const metadata of [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
        "/.well-known/oauth-authorization-server",
      ])
        assert.equal((await fetch(local + metadata)).status, 200);
      assert.equal(
        (await fetch(`${local}/oauth/connections`, { redirect: "manual" }))
          .status,
        302
      );
      const callback = "https://client.suite.test/callback";
      const registration = await fetch(`${local}/oauth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Browser test client",
          redirect_uris: [callback],
        }),
      });
      assert.equal(registration.status, 201);
      const clientId = (await registration.json()).client_id;
      const verifier = randomBytes(32).toString("base64url");
      const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: callback,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
        resource: `${origin}/mcp`,
        scope: "shop:read shop:manage",
        state: "client-state",
      });
      const authorization = `/oauth/authorize?${params}`;
      assert.equal(
        (await fetch(local + authorization, { redirect: "manual" })).status,
        302
      );
      browser = await chromium.launch({ headless: true });
      // Model the isolated Suite gateway: it injects the verified member and
      // forwards the browser's public-origin requests to the built app over HTTP.
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        colorScheme: "dark",
      });
      let redirectLocation: string | undefined;
      await context.route(`${origin}/**`, async (route) => {
        const incoming = route.request();
        const url = new URL(incoming.url());
        const upstream = await fetch(local + url.pathname + url.search, {
          method: incoming.method(),
          headers: { ...incoming.headers(), ...identity },
          body: incoming.postData() ?? undefined,
          redirect: "manual",
        });
        // Playwright routes only the first request in a redirect chain. Capture
        // form redirects so the simulated gateway can re-inject identity on the
        // next navigation, just as the real gateway does for each request.
        if (upstream.status === 303) {
          redirectLocation = upstream.headers.get("location")!;
          await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: "Returned to the client",
          });
          return;
        }
        await route.fulfill({
          status: upstream.status,
          headers: Object.fromEntries(upstream.headers),
          body: Buffer.from(await upstream.arrayBuffer()),
        });
      });
      await context.route(`${callback}**`, (route) =>
        route.fulfill({ body: "Returned to the client" })
      );
      const page = await context.newPage();
      await page.goto(origin + authorization);
      await expect(
        page.getByRole("heading", {
          name: "Connect Browser test client",
          exact: true,
        })
      ).toBeVisible();
      await expect(
        page.getByText("Name not verified", { exact: true })
      ).toBeVisible();
      await expect(
        page.getByText(
          "Assign machines, prioritize queues and change work status",
          { exact: true }
        )
      ).toBeVisible();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
      );
      const requestId = await page
        .locator('input[name="request"]')
        .inputValue();
      // A different Suite member cannot finish Alice's consent.
      const bob = {
        ...identity,
        "X-Token-Subject": "slack:TRHR:UBOB",
        "X-Hawk-Slack-User": "UBOB",
      };
      const consentForm = new URLSearchParams({
        request: requestId,
        decision: "approve",
      });
      assert.equal(
        (
          await fetch(`${local}/oauth/authorize`, {
            method: "POST",
            headers: { ...bob, Origin: origin },
            body: consentForm,
            redirect: "manual",
          })
        ).status,
        400
      );
      for (const badOrigin of [undefined, "https://attacker.test"])
        assert.equal(
          (
            await fetch(`${local}/oauth/authorize`, {
              method: "POST",
              headers: {
                ...identity,
                ...(badOrigin ? { Origin: badOrigin } : {}),
              },
              body: consentForm,
              redirect: "manual",
            })
          ).status,
          403
        );
      await page.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(
        page.getByText("Returned to the client", { exact: true })
      ).toBeVisible();
      assert.ok(redirectLocation?.startsWith(callback + "?"));
      const returned = new URL(redirectLocation!);
      assert.equal(returned.searchParams.get("state"), "client-state");
      assert.equal(returned.searchParams.get("iss"), origin);
      const tokenResponse = await fetch(`${local}/oauth/token`, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          redirect_uri: callback,
          code: returned.searchParams.get("code")!,
          code_verifier: verifier,
          resource: `${origin}/mcp`,
        }),
      });
      assert.equal(
        tokenResponse.status,
        200,
        await tokenResponse.clone().text()
      );
      const tokens = await tokenResponse.json();
      const headers = {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };
      assert.equal(
        (await fetch(`${local}/api/kanban/cards`, { headers })).status,
        401
      );
      assert.equal(
        (await fetch(`${local}/mcp/`, { headers, redirect: "manual" })).status,
        302
      );
      const client = new Client({ name: "runtime-check", version: "1" });
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(`${local}/mcp`), {
            requestInit: { headers: { Authorization: headers.Authorization } },
          })
        );
        assert.ok(
          (await client.listTools()).tools.some(
            (t) => t.name === "assign_machine"
          )
        );
        assert.equal(
          (await client.callTool({ name: "list_released_work", arguments: {} }))
            .isError,
          undefined
        );
      } finally {
        await client.close();
      }
      const refreshed = await fetch(`${local}/oauth/token`, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: tokens.refresh_token,
        }),
      });
      assert.equal(refreshed.status, 200);
      const rotated = await refreshed.json();
      await page.goto(origin + "/oauth/connections");
      await expect(
        page.getByRole("heading", { name: "Connected apps", exact: true })
      ).toBeVisible();
      await expect(
        page.getByText(`${origin}/mcp`, { exact: true })
      ).toBeVisible();
      await expect(
        page.getByText("Browser test client", { exact: true })
      ).toBeVisible();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
      );
      await page.emulateMedia({ colorScheme: "light" });
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(
        page.getByRole("button", { name: "Disconnect Browser test client" })
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Disconnect Browser test client" })
        .click();
      await expect(
        page.getByText("Returned to the client", { exact: true })
      ).toBeVisible();
      assert.equal(redirectLocation, "/oauth/connections");
      await page.goto(origin + "/oauth/connections");
      await expect(
        page.getByText("No connected apps.", { exact: true })
      ).toBeVisible();
      const revoked = await fetch(`${local}/mcp`, {
        method: "POST",
        headers: {
          ...headers,
          Authorization: `Bearer ${rotated.access_token}`,
        },
        body: "{}",
      });
      assert.equal(revoked.status, 401);
      assert.equal(
        (
          await fetch(`${local}/oauth/token`, {
            method: "POST",
            body: new URLSearchParams({
              grant_type: "refresh_token",
              client_id: clientId,
              refresh_token: rotated.refresh_token,
            }),
          })
        ).status,
        400
      );
      assert.equal(
        (
          await fetch(`${local}/oauth/register`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: "https://attacker.test",
            },
            body: "{}",
          })
        ).status,
        403
      );
      await context.close();
    } finally {
      await browser?.close();
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  }
);
