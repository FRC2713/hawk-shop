import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

test("single and bulk dialogs list all issues and block only error parts", async () => {
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
    import { createRoot } from 'react-dom/client';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { AddCardDialog } from './src/components/mfg/AddCardDialog';
    import { BulkReleaseDialog } from './src/components/mfg/BulkReleaseDialog';
    const client = new QueryClient({ defaultOptions: {queries: {retry: false}} });
    const blocked = {partId: 'blocked', partNumber: 'BLOCKED', name: 'Blocked part'};
    const warning = {partId: 'warning', partNumber: 'WARN', name: 'Warning part', material: {displayName: 'Unknown'}};
    window.show = (bulk) => createRoot(document.getElementById('root')).render(
      <QueryClientProvider client={client}>{bulk ?
      <BulkReleaseDialog open onOpenChange={()=>{}} selectedParts={[
        {part: blocked, partKey: 'blocked', partId:'blocked', onshapeParams:{instanceType:'w'}},
        {part: warning, partKey: 'warning', partId:'warning', onshapeParams:{instanceType:'w'}}
      ]} onSubmit={data=>window.submitted=data} /> :
      <AddCardDialog open onOpenChange={()=>{}} part={blocked} instanceType="w" onSubmit={data=>window.submitted=data} />}
      </QueryClientProvider>);
  `,
    },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(3000);
    await page.route("**/api/**", (route) =>
      route.fulfill({
        json: { processes: [{ id: "process-other", name: "Other" }] },
      })
    );
    await page.route("http://localhost:32199/", (route) =>
      route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' })
    );
    async function show(bulk: boolean) {
      await page.goto("http://localhost:32199");
      await page.setContent('<div id="root"></div>');
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate((bulk) => (window as any).show(bulk), bulk);
      await page.getByRole("dialog").waitFor();
    }
    await show(false);
    await page
      .getByText("This part has no material.", { exact: true })
      .waitFor();
    await page
      .getByText("This part has no description.", { exact: true })
      .waitFor();
    await page
      .getByText(
        "This part is being released from a workspace that may still change.",
        { exact: true }
      )
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Release", exact: true })
        .isDisabled(),
      true
    );
    await show(true);
    await page
      .getByText("This part has no material.", { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByText("This part has no description.", { exact: true })
        .count(),
      2
    );
    await page
      .getByText("This part uses a placeholder material.", { exact: true })
      .waitFor();
    await page.getByRole("combobox").click();
    await page.getByText("Other", { exact: true }).click();
    await page.keyboard.press("Escape");
    await page.locator("#qty-robot-warning").fill("4");
    await page.locator("#qty-make-warning").fill("2");
    await page
      .getByText("Quantity to make is below quantity per robot.", {
        exact: true,
      })
      .waitFor();
    const submit = page.getByRole("button", {
      name: "Release 1 Parts",
      exact: true,
    });
    assert.equal(await submit.isEnabled(), true);
    assert.equal(await page.locator("#qty-robot-blocked").isDisabled(), true);
    await submit.click();
    assert.deepEqual(
      await page.evaluate(() => (window as any).submitted.partQuantities),
      [{ partKey: "warning", quantityPerRobot: 4, quantityToMake: 2 }]
    );
  } finally {
    await browser.close();
  }
});
