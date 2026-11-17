import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
process.env.DATA_DIR = mkdtempSync(
  path.join(tmpdir(), "hawk-equipment-editor-")
);
const { endpoint, signIn, jsonRequest } = await import("./http-fixture");
const equipment = await import("../src/pages/api/equipment/index");
const item = await import("../src/pages/api/equipment/[id]");
const images = await import("../src/pages/api/equipment/[id]/image");

test("photo order persists and its first image becomes the thumbnail, without accepting missing or foreign photos", async () => {
  const cookie = await signIn();
  const created = await endpoint(
    equipment,
    "POST"
  )(
    jsonRequest("/api/equipment", "POST", cookie, {
      name: "Printer",
      imageUrls: ["/front.png", "/plate.png", "/controls.png"],
    })
  );
  const { equipment: machine } = await created.json();
  const reorder = (imageUrls: unknown) =>
    endpoint(images, "PUT", { id: machine.id })(
      jsonRequest(`/api/equipment/${machine.id}/image`, "PUT", cookie, {
        imageUrls,
      })
    );
  assert.equal(
    (await reorder(["/controls.png", "/front.png", "/plate.png"])).status,
    200
  );
  const read = await endpoint(item, "GET", { id: machine.id })(
    new Request("http://localhost/api/equipment/" + machine.id, {
      headers: { Cookie: cookie },
    })
  );
  assert.deepEqual((await read.json()).equipment.image_urls, [
    "/controls.png",
    "/front.png",
    "/plate.png",
  ]);
  for (const invalid of [
    ["/front.png"],
    ["/front.png", "/plate.png", "/foreign.png"],
    ["/front.png", "/front.png", "/plate.png"],
    null,
  ]) {
    assert.equal((await reorder(invalid)).status, 400);
  }
});

test("equipment APIs retain processes, SOP and ordered uploads while maintenance can be set and cleared", async () => {
  const cookie = await signIn();
  const processRoute = await import("../src/pages/api/processes/index");
  const maintenanceRoute =
    await import("../src/pages/api/equipment/[id]/maintenance");
  const processResponse = await endpoint(
    processRoute,
    "POST"
  )(jsonRequest("/api/processes", "POST", cookie, { name: "Printing" }));
  const { process } = await processResponse.json();
  const created = await endpoint(
    equipment,
    "POST"
  )(
    jsonRequest("/api/equipment", "POST", cookie, {
      name: "Printer 2",
      location: "Farm",
      processIds: [process.id],
      documentationUrl: "https://docs.google.com/document/d/sop/edit",
    })
  );
  assert.equal(created.status, 201);
  const { equipment: machine } = await created.json();
  const read = async () =>
    (
      await (
        await endpoint(item, "GET", { id: machine.id })(
          new Request("http://localhost/api/equipment/" + machine.id, {
            headers: { Cookie: cookie },
          })
        )
      ).json()
    ).equipment;
  const uploaded: string[] = [];
  for (const name of ["front.png", "plate.png"]) {
    const body = new FormData();
    body.append("file", new File(["photo"], name, { type: "image/png" }));
    const response = await endpoint(images, "POST", { id: machine.id })(
      new Request(`http://localhost/api/equipment/${machine.id}/image`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: "http://localhost" },
        body,
      })
    );
    assert.equal(response.status, 201);
    uploaded.push((await response.json()).imageUrl);
  }
  let saved = await read();
  assert.deepEqual(saved.image_urls, uploaded);
  assert.equal(
    saved.documentation_url,
    "https://docs.google.com/document/d/sop/edit"
  );
  assert.deepEqual(
    saved.processes.map((p: { id: string }) => p.id),
    [process.id]
  );
  assert.equal(
    (
      await endpoint(maintenanceRoute, "POST", { id: machine.id })(
        jsonRequest(
          `/api/equipment/${machine.id}/maintenance`,
          "POST",
          cookie,
          { note: "Loose belt" }
        )
      )
    ).status,
    200
  );
  saved = await read();
  assert.equal(saved.status, "maintenance");
  assert.equal(saved.maintenance_note, "Loose belt");
  assert.equal(
    (
      await endpoint(maintenanceRoute, "DELETE", { id: machine.id })(
        jsonRequest(
          `/api/equipment/${machine.id}/maintenance`,
          "DELETE",
          cookie,
          {}
        )
      )
    ).status,
    200
  );
  assert.equal((await read()).maintenance_note, null);
  await endpoint(images, "PUT", { id: machine.id })(
    jsonRequest(`/api/equipment/${machine.id}/image`, "PUT", cookie, {
      imageUrls: [uploaded[1], uploaded[0]],
    })
  );
  await endpoint(images, "DELETE", { id: machine.id })(
    new Request(
      `http://localhost/api/equipment/${machine.id}/image?imageUrl=${encodeURIComponent(uploaded[1])}`,
      {
        method: "DELETE",
        headers: { Cookie: cookie, Origin: "http://localhost" },
      }
    )
  );
  assert.deepEqual(
    (await read()).image_urls,
    [uploaded[0]],
    "removing the cover promotes the next photo"
  );
});

test("two photos with the same camera filename remain distinct even within the same millisecond", async (t) => {
  const cookie = await signIn();
  const created = await endpoint(
    equipment,
    "POST"
  )(jsonRequest("/api/equipment", "POST", cookie, { name: "Camera printer" }));
  const { equipment: machine } = await created.json();
  t.mock.method(Date, "now", () => 1800000000000);
  const urls: string[] = [];
  for (const contents of ["front", "controls"]) {
    const body = new FormData();
    body.append(
      "file",
      new File([contents], "image.jpg", { type: "image/jpeg" })
    );
    const response = await endpoint(images, "POST", { id: machine.id })(
      new Request(`http://localhost/api/equipment/${machine.id}/image`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: "http://localhost" },
        body,
      })
    );
    assert.equal(response.status, 201);
    urls.push((await response.json()).imageUrl);
  }
  assert.notEqual(urls[0], urls[1]);
});
