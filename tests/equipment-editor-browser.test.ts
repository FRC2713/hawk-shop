import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

test("camera-first editor at 390px reorders and removes photos, saves chips and SOP, and marks a machine fixed", async () => {
  const bundle = await build({
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
    import {EquipmentEditor} from './src/components/mfg/equipment/EquipmentEditor';
    const equipment = {id:'printer', name:'Printer', location:'Shop', processes:[], image_urls:['/front.png','/plate.png','/controls.png'], status:'maintenance', maintenance_note:'Loose belt'};
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><EquipmentEditor equipment={equipment} allEquipment={[equipment]} onCancel={()=>{}} onSaved={()=>{}} /></QueryClientProvider>);
  `,
    },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    const requests: { method: string; path: string; body: any }[] = [];
    await page.route("http://localhost:32198/**", (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/api/")) {
        requests.push({
          method: request.method(),
          path,
          body: request.postDataJSON(),
        });
        if (path === "/api/processes")
          return route.fulfill({
            json: { processes: [{ id: "print", name: "3D Printing" }] },
          });
        return route.fulfill({
          json: {
            equipment: { id: "printer", name: "Printer" },
            success: true,
          },
        });
      }
      return route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div>',
      });
    });
    await page.goto("http://localhost:32198/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await expect(
      page.getByRole("button", { name: "Take photo", exact: true })
    ).toBeVisible();
    const camera = page.locator("input[type=file][capture=environment]");
    await expect(camera).toHaveAttribute("accept", "image/*");
    assert.equal(
      await page.locator("input[type=file]:not([capture])").count(),
      1
    );
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Take photo", exact: true }).click();
    assert.equal((await chooser).isMultiple(), false);
    await page.getByRole("button", { name: "Move photo 3 earlier" }).click();
    await page.getByRole("button", { name: "Move photo 2 earlier" }).click();
    await expect(
      page
        .getByRole("list", { name: "Equipment photos" })
        .locator("img")
        .first()
    ).toHaveAttribute("src", "/controls.png");
    await page
      .getByRole("button", { name: "Remove photo 2", exact: true })
      .click();
    await expect(
      page.getByRole("list", { name: "Equipment photos" }).locator("img")
    ).toHaveCount(2);
    await page
      .getByRole("button", { name: "3D Printing", exact: true })
      .click();
    await page
      .getByLabel("SOP link")
      .fill("https://docs.google.com/document/d/sop/edit");
    await expect(page.getByText("Loose belt", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Mark fixed", exact: true }).click();
    await expect(
      page.getByText("No maintenance reported.", { exact: true })
    ).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(() =>
        requests.some((r) => r.method === "PUT" && r.path.endsWith("/image"))
      )
      .toBe(true);
    assert.deepEqual(
      requests.find((r) => r.method === "PUT" && r.path.endsWith("/image"))!
        .body,
      { imageUrls: ["/controls.png", "/plate.png"] }
    );
    assert.ok(
      requests.some((r) => r.method === "DELETE" && r.path.endsWith("/image"))
    );
    assert.ok(
      requests.some(
        (r) => r.method === "DELETE" && r.path.endsWith("/maintenance")
      )
    );
    const saved = requests.find(
      (r) => r.method === "PUT" && r.path === "/api/equipment/printer"
    )!.body;
    assert.deepEqual(saved.processIds, ["print"]);
    assert.equal(
      saved.documentationUrl,
      "https://docs.google.com/document/d/sop/edit"
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(
      page.getByRole("button", { name: "Take photo", exact: true })
    ).toBeVisible();
  } finally {
    await browser.close();
  }
});

test("phone photos upload as resized JPEGs in tile order and a failed save can be retried without creating another machine", async () => {
  const bundle = await build({
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {EquipmentEditor} from './src/components/mfg/equipment/EquipmentEditor';
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><EquipmentEditor allEquipment={[]} onCancel={()=>{}} onSaved={()=>{document.title='Saved'}} /></QueryClientProvider>);
  `,
    },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    const uploads: File[] = [];
    let creates = 0;
    let failOrder = true;
    let order: string[] = [];
    await page.route("http://localhost:32198/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname === "/api/processes")
        return route.fulfill({ json: { processes: [] } });
      if (pathname === "/api/equipment" && request.method() === "POST") {
        creates++;
        return route.fulfill({
          json: { equipment: { id: "new-printer", name: "Printer" } },
        });
      }
      if (pathname.endsWith("/image") && request.method() === "POST") {
        const form = await new Request(request.url(), {
          method: "POST",
          headers: request.headers(),
          body: new Uint8Array(request.postDataBuffer()!),
        }).formData();
        uploads.push(form.get("file") as File);
        return route.fulfill({
          status: 201,
          json: { imageUrl: `/uploaded-${uploads.length}.jpg` },
        });
      }
      if (pathname.endsWith("/image") && request.method() === "PUT") {
        order = request.postDataJSON().imageUrls;
        if (failOrder) {
          failOrder = false;
          return route.fulfill({ status: 503, json: { error: "Try again" } });
        }
        return route.fulfill({ json: { success: true } });
      }
      if (pathname.startsWith("/api/"))
        return route.fulfill({
          json: { equipment: { id: "new-printer", name: "Printer" } },
        });
      return route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div>',
      });
    });
    await page.goto("http://localhost:32198/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const original = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 4000;
      canvas.height = 1000;
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await page.getByLabel("Library photos").setInputFiles([
      {
        name: "front.png",
        mimeType: "image/png",
        buffer: Buffer.from(original, "base64"),
      },
      {
        name: "plate.png",
        mimeType: "image/png",
        buffer: Buffer.from(original, "base64"),
      },
    ]);
    await expect(
      page.getByRole("list", { name: "Equipment photos" }).locator("img")
    ).toHaveCount(2);
    await page.getByRole("button", { name: "Move photo 2 earlier" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Printer");
    await page
      .getByRole("button", { name: "Add equipment", exact: true })
      .click();
    await expect(page.getByText(/Could not save:/)).toBeVisible();
    await page
      .getByRole("button", { name: "Add equipment", exact: true })
      .click();
    await expect(page).toHaveTitle("Saved");
    assert.equal(creates, 1);
    assert.equal(uploads.length, 2);
    assert.deepEqual(
      uploads.map((file) => [file.name, file.type]),
      [
        ["plate.jpg", "image/jpeg"],
        ["front.jpg", "image/jpeg"],
      ]
    );
    assert.deepEqual(order, ["/uploaded-1.jpg", "/uploaded-2.jpg"]);
    const dimensions = await page.evaluate(
      async (base64) => {
        const image = new Image();
        image.src = "data:image/jpeg;base64," + base64;
        await image.decode();
        return [image.naturalWidth, image.naturalHeight];
      },
      Buffer.from(await uploads[0].arrayBuffer()).toString("base64")
    );
    assert.deepEqual(dimensions, [2000, 500]);
  } finally {
    await browser.close();
  }
});
