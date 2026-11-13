import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "hawk-projects-"));
const { endpoint, signIn, jsonRequest } = await import("./http-fixture");
const projects = await import("../src/pages/api/projects/index");
const project = await import("../src/pages/api/projects/[id]");
const cards = await import("../src/pages/api/kanban/cards/index");
const { sortProjectsForPicker, sortProjectsForDisplay } =
  await import("../src/lib/api/projects");

let cookie = "";
async function create(name: unknown) {
  const response = await endpoint(projects, "POST")(
    jsonRequest("/api/projects", "POST", cookie, { name }),
    {}
  );
  return { status: response.status, body: await response.json() };
}
async function patch(id: string, body: unknown) {
  const response = await endpoint(project, "PATCH", { id })(
    jsonRequest(`/api/projects/${id}`, "PATCH", cookie, body),
    {}
  );
  return { status: response.status, body: await response.json() };
}
async function list() {
  const response = await endpoint(projects, "GET")(
    new Request("http://localhost/api/projects", {
      headers: { Cookie: cookie },
    }),
    {}
  );
  return (await response.json()).projects as Array<Record<string, any>>;
}

test("Miscellaneous exists and every existing card defaults to it", async () => {
  cookie = await signIn();
  const all = await list();
  assert.deepEqual(
    all.map((row) => [row.id, row.name]),
    [["project-miscellaneous", "Miscellaneous"]]
  );
  const response = await endpoint(cards, "POST")(
    jsonRequest("/api/kanban/cards", "POST", cookie, { title: "Plate" }),
    {}
  );
  assert.equal(
    (await response.json()).card.project_id,
    "project-miscellaneous"
  );
});

test("names are trimmed and unique ignoring case", async () => {
  const first = await create("  Intake   Roller ");
  assert.equal(first.status, 201);
  assert.equal(first.body.project.name, "Intake Roller");
  const again = await create("intake roller");
  assert.equal(again.status, 200);
  assert.equal(again.body.project.id, first.body.project.id);
  assert.equal((await create("")).status, 400);
  assert.equal((await create("x".repeat(61))).status, 400);
  assert.equal((await create(7)).status, 400);
});

test("rename and archive; asking for an archived name restores it", async () => {
  const climber = (await create("Climber")).body.project;
  const shooter = (await create("Shooter")).body.project;
  assert.equal((await patch(climber.id, { name: "SHOOTER" })).status, 409);
  const renamed = await patch(climber.id, { name: "Climber v2" });
  assert.equal(renamed.body.project.name, "Climber v2");
  const archived = await patch(shooter.id, { archived: true });
  assert.ok(archived.body.project.archived_at);
  assert.equal((await patch(shooter.id, { archived: "yes" })).status, 400);
  const restored = await create("shooter");
  assert.equal(restored.body.project.id, shooter.id);
  assert.equal(restored.body.project.archived_at, null);
  assert.equal((await patch("project-nope", { name: "X" })).status, 404);
});

test("Miscellaneous can't be renamed or archived", async () => {
  assert.equal(
    (await patch("project-miscellaneous", { name: "Other" })).status,
    400
  );
  assert.equal(
    (await patch("project-miscellaneous", { archived: true })).status,
    400
  );
});

test("the picker puts my recent projects first and hides archived ones", async () => {
  const intake = (await create("Intake Roller")).body.project;
  const bob = await signIn("bob@example.com", "bob");
  await endpoint(cards, "POST")(
    jsonRequest("/api/kanban/cards", "POST", cookie, {
      title: "Roller",
      projectId: intake.id,
    }),
    {}
  );
  const archived = (await create("Drivetrain")).body.project;
  await patch(archived.id, { archived: true });
  const mine = await list();
  assert.deepEqual(
    sortProjectsForPicker(mine as any).map((row) => row.name),
    ["Intake Roller", "Climber v2", "Shooter", "Miscellaneous"]
  );
  assert.equal(mine.find((row) => row.id === intake.id)!.card_count, 1);
  cookie = bob;
  assert.deepEqual(
    sortProjectsForPicker((await list()) as any).map((row) => row.name),
    ["Climber v2", "Intake Roller", "Shooter", "Miscellaneous"],
    "another member's releases don't count as recent for me"
  );
  assert.deepEqual(
    sortProjectsForDisplay(mine as any).map((row) => row.name),
    ["Climber v2", "Drivetrain", "Intake Roller", "Shooter", "Miscellaneous"]
  );
});
