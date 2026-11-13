import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { request as proxyRequest } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import Database from "better-sqlite3";
import { chromium, expect } from "@playwright/test";

// The real Caddy/JWT boundary is exercised in Suite's test-auth-routing.py.
// This fixture exercises browser cookie partitioning, popup messaging and the
// actual Shop release route without Slack credentials or paid Onshape calls.
test(
  "connect once and release a CAD part inside a cross-site iframe",
  { timeout: 60000 },
  async () => {
    const data = await mkdtemp(join(tmpdir(), "hawk-shop-embedded-"));
    const socket = createServer();
    await new Promise<void>((resolve) =>
      socket.listen(0, "127.0.0.1", resolve)
    );
    const address = socket.address();
    assert.ok(address && typeof address === "object");
    const port = address.port;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    const upstream = `http://127.0.0.1:${port}`;
    let shop = "";
    let topLevelEmbedded = false;
    const cad = "https://cad.onshape.com";
    const connector =
      "/onshape_connector?documentId=doc&instanceType=v&instanceId=version&elementId=element&elementType=PARTSTUDIO";
    const transport = join(data, "no-network.mjs");
    await writeFile(
      transport,
      `globalThis.fetch = async () => { throw new Error("Unexpected external request"); };`
    );
    const server = spawn(
      process.execPath,
      ["--import", transport, "dist/server/entry.mjs"],
      {
        env: {
          ...process.env,
          NODE_ENV: "production",
          HOST: "127.0.0.1",
          PORT: String(port),
          DATA_DIR: data,
          APP_URL: upstream,
          HAWK_SUITE_TRUST_PROXY: "true",
          HAWK_SUITE_TEAM_ID: "TTEAM",
          HAWK_SUITE_ISSUER: "https://suite.fixture.test/",
          ONSHAPE_ACCESS_KEY: "fixture",
          ONSHAPE_SECRET_KEY: "fixture",
          ONSHAPE_WEBHOOK_SECRET: "",
          ONSHAPE_WEBHOOK_BASE_URL: "",
          SLACK_BOT_TOKEN: "",
          DATABASE_PATH: "",
          UPLOADS_DIR: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let output = "";
    server.stdout.on("data", (chunk) => {
      output += chunk;
    });
    server.stderr.on("data", (chunk) => {
      output += chunk;
    });
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(data, "key.pem"),
        "-out",
        join(data, "cert.pem"),
        "-subj",
        "/CN=localhost",
        "-days",
        "1",
      ],
      { stdio: "ignore" }
    );
    const gateway = createHttpsServer(
      {
        key: readFileSync(join(data, "key.pem")),
        cert: readFileSync(join(data, "cert.pem")),
      },
      (request, response) => {
        const headers = { ...request.headers };
        if (
          request.url === "/auth/embed/session" &&
          headers["sec-fetch-dest"] === "document"
        )
          topLevelEmbedded = (headers.cookie || "").includes(
            "__Host-hawk-shop-embedded="
          );
        const authenticated =
          /(?:^|; )(__Host-hawk-shop-embedded|AUTHP_ACCESS_TOKEN)=fixture-suite-token(?:;|$)/.test(
            headers.cookie || ""
          );
        if (authenticated)
          Object.assign(headers, {
            "x-token-subject": "slack:TTEAM:UMEMBER",
            "x-hawk-slack-team": "TTEAM",
            "x-hawk-slack-user": "UMEMBER",
            "x-token-user-roles": "suite/member",
          });
        // Adapt the fixture's HTTPS browser origin to its local HTTP upstream.
        if (headers.origin === shop) headers.origin = upstream;
        delete headers.host;
        const proxy = proxyRequest(
          upstream + request.url,
          { method: request.method, headers },
          (incoming) => {
            response.writeHead(incoming.statusCode || 500, incoming.headers);
            incoming.pipe(response);
          }
        );
        proxy.on("error", () => {
          response.writeHead(502);
          response.end();
        });
        response.on("close", () => proxy.destroy());
        request.pipe(proxy);
      }
    );
    await new Promise<void>((resolve) =>
      gateway.listen(0, "127.0.0.1", resolve)
    );
    const gatewayAddress = gateway.address();
    assert.ok(gatewayAddress && typeof gatewayAddress === "object");
    shop = `https://127.0.0.1:${gatewayAddress.port}`;
    const browser = await chromium.launch({ headless: true });
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          if ((await fetch(upstream + "/health")).ok) break;
        } catch {}
        if (server.exitCode !== null || attempt === 100)
          throw new Error(output);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const db = new Database(join(data, "hawk-shop.db"));
      db.prepare(
        "INSERT INTO onshape_api_cache(cache_key,payload,created_at,expires_at) VALUES (?,?,?,NULL)"
      ).run(
        "parts::doc::v::version::element",
        JSON.stringify([
          {
            partId: "part",
            name: "Iframe bracket",
            partNumber: "IFRAME-001",
            description: "Embedded release fixture",
            material: { displayName: "Aluminum" },
            microversionId: "micro",
          },
        ]),
        new Date().toISOString()
      );
      db.prepare(
        "INSERT INTO onshape_api_cache(cache_key,payload,created_at,expires_at) VALUES (?,?,?,NULL)"
      ).run(
        "version::doc::version",
        JSON.stringify({ name: "Fixture version" }),
        new Date().toISOString()
      );
      db.close();
      await fetch(upstream + "/api/processes", {
        method: "POST",
        headers: {
          Origin: upstream,
          "Content-Type": "application/json",
          "x-token-subject": "slack:TTEAM:UMEMBER",
          "x-hawk-slack-team": "TTEAM",
          "x-hawk-slack-user": "UMEMBER",
          "x-token-user-roles": "suite/member",
        },
        body: JSON.stringify({ name: "Fixture machining" }),
      });
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      // Only the disposable fixture uses loopback behind a public-site origin.
      await context.grantPermissions(["local-network-access"], { origin: cad });
      const errors: string[] = [];
      context.on("page", (page) =>
        page.on("pageerror", (error) => errors.push(error.message))
      );
      await context.addCookies([
        {
          name: "AUTHP_ACCESS_TOKEN",
          value: "fixture-suite-token",
          url: shop,
          secure: true,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      await context.route(cad + "/**", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<style>body {margin:0} iframe {width:100%;height:100vh;border:0}</style><iframe title="Hawk Shop" src="${shop}${connector}"></iframe>`,
        })
      );
      const page = await context.newPage();
      await page.goto(cad);
      const frame = page.frameLocator('iframe[title="Hawk Shop"]');
      await expect(
        frame.getByRole("button", { name: "Connect Hawk Suite" })
      ).toBeVisible();
      const popupEvent = page.waitForEvent("popup");
      await frame.getByRole("button", { name: "Connect Hawk Suite" }).click();
      const popup = await popupEvent;
      await expect(
        frame.getByText("Iframe bracket", { exact: true })
      ).toBeVisible();
      await expect.poll(() => popup.isClosed()).toBe(true);
      assert.equal(page.url(), cad + "/");
      assert.equal(page.frames()[1].url(), shop + connector);
      const cookies = await context.cookies();
      const embedded = cookies.find(
        (cookie) => cookie.name === "__Host-hawk-shop-embedded"
      );
      assert.ok(embedded?.httpOnly && embedded.secure);
      assert.equal(embedded.sameSite, "None");
      assert.equal(embedded.partitionKey, "https://onshape.com");

      await frame
        .getByRole("button", { name: "Release", exact: true })
        .first()
        .click();
      await expect(frame.getByRole("dialog")).toBeVisible();
      await frame
        .getByRole("button", { name: "Fixture machining", exact: true })
        .click();
      await frame.getByRole("combobox", { name: "Project" }).click();
      await frame.getByRole("option", { name: "Miscellaneous" }).click();
      await frame.getByLabel("Quantity to make", { exact: true }).fill("4");
      await frame
        .getByRole("dialog")
        .getByRole("button", { name: /^Release( \d+)?$/ })
        .click();
      await expect
        .poll(async () => {
          const database = new Database(join(data, "hawk-shop.db"));
          try {
            return database
              .prepare(
                "SELECT created_by, quantity_to_make FROM kanban_cards WHERE title='IFRAME-001'"
              )
              .get();
          } finally {
            database.close();
          }
        })
        .toEqual({
          created_by: "slack:TTEAM:UMEMBER",
          quantity_to_make: 4,
        });
      await page.reload();
      await expect(
        frame.getByText("Iframe bracket", { exact: true })
      ).toBeVisible();
      assert.equal(context.pages().length, 1);
      await context.clearCookies({ name: "AUTHP_ACCESS_TOKEN" });
      const topLevel = await context.newPage();
      await topLevel.goto(shop + "/auth/embed/session").catch(() => {});
      assert.equal(
        topLevelEmbedded,
        false,
        "Onshape's partitioned session must not authenticate a top-level Shop tab"
      );
      await topLevel.close();
      await page.reload();
      await expect(
        frame.getByText("Iframe bracket", { exact: true })
      ).toBeVisible();
      assert.deepEqual(errors, []);
      await context.close();
    } finally {
      await browser.close();
      gateway.closeAllConnections();
      await new Promise<void>((resolve) => gateway.close(() => resolve()));
      if (server.exitCode === null) {
        const exited = new Promise((resolve) => server.once("exit", resolve));
        server.kill("SIGTERM");
        await exited;
      }
      await rm(data, { recursive: true, force: true });
    }
  }
);
