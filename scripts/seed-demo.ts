/** Local-only demo data. Run with node --import tsx scripts/seed-demo.ts after starting dev once. */
import { registerHooks } from "node:module";
import path from "node:path";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";

const localData = path.resolve("data");
const localDatabase = path.join(localData, "hawk-shop.db");
if (
  process.env.NODE_ENV === "production" ||
  (process.env.DATA_DIR && path.resolve(process.env.DATA_DIR) !== localData) ||
  (process.env.DATABASE_PATH &&
    path.resolve(process.env.DATABASE_PATH) !== localDatabase) ||
  process.env.UPLOADS_DIR
)
  throw new Error(
    "Demo seeding only supports this checkout's default local data directory."
  );
if (!existsSync(localDatabase))
  throw new Error("Start the local dev server once before seeding demo data.");

// This standalone Node script runs server modules outside Vite.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "virtual:hawk-shop/server-only")
      return { url: "data:text/javascript,export{}", shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const backup = `${localDatabase}.before-demo-${Date.now()}.bak`;
const original = new Database(localDatabase);
await original.backup(backup);
original.close();

const { db, schema } = await import("../src/server/db/client");
const { saveFile } = await import("../src/server/storage/files");
const { shopDay } = await import("../src/server/stationRoster");
const now = new Date().toISOString();
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86400000).toISOString();
const dateIn = (days: number) => daysAgo(-days).slice(0, 10);
const localUser = "slack:TLOCALDEV:ULOCALDEV";
const members = [
  { onshape_user_id: localUser, name: "Local Developer" },
  { onshape_user_id: "demo-alex", name: "Alex Chen" },
  { onshape_user_id: "demo-jordan", name: "Jordan Rivera" },
  { onshape_user_id: "demo-sam", name: "Sam Patel" },
];
const projectNames = ["Drivetrain", "Intake", "Elevator"];
const machines = [
  {
    id: "mill",
    name: "Haas Mini Mill",
    process: "cnc-milling",
    location: "Machine shop",
    description: "Aluminum plates, bearing blocks, and precision brackets.",
  },
  {
    id: "router",
    name: "CNC Router",
    process: "cnc-milling",
    location: "Machine shop",
    description: "Sheet stock and large polycarbonate panels.",
  },
  {
    id: "printer",
    name: "Prusa MK4",
    process: "3d-printing",
    location: "Print lab",
    description: "PLA and PETG prototypes, spacers, and cable guides.",
  },
  {
    id: "printer-2",
    name: "Bambu X1 Carbon",
    process: "3d-printing",
    location: "Print lab",
    description: "Enclosed printer for production parts.",
    maintenance: true,
  },
  {
    id: "bandsaw",
    name: "Horizontal Bandsaw",
    process: "material-processing",
    location: "Stock room",
    description: "Cut tube and bar stock to length.",
  },
  {
    id: "bench",
    name: "Assembly Bench",
    process: "hand-tooling",
    location: "Main shop",
    description: "Deburring, fitting, and manual finishing.",
  },
];

// Local SVG previews, no external CAD or image requests.
const shapes = [
  '<path d="M70 90h180v125H70z" fill="#a8b7c8" stroke="#475569" stroke-width="5"/><g fill="#eef2f6" stroke="#475569" stroke-width="4"><circle cx="100" cy="120" r="12"/><circle cx="220" cy="120" r="12"/><circle cx="100" cy="185" r="12"/><circle cx="220" cy="185" r="12"/><circle cx="160" cy="152" r="30"/></g>',
  '<path d="M80 210V95h45v70h115v45z" fill="#94a3b8" stroke="#475569" stroke-width="5"/><g fill="#eef2f6" stroke="#475569" stroke-width="4"><circle cx="102" cy="123" r="10"/><circle cx="153" cy="188" r="10"/><circle cx="210" cy="188" r="10"/></g>',
  '<ellipse cx="160" cy="160" rx="95" ry="68" fill="#ef4444" stroke="#991b1b" stroke-width="5"/><ellipse cx="160" cy="160" rx="43" ry="31" fill="#eef2f6" stroke="#991b1b" stroke-width="5"/>',
];
const images: string[] = [];
for (let i = 0; i < shapes.length; i++) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="280" viewBox="0 0 320 280"><rect width="320" height="280" rx="16" fill="#eef2f6"/>${shapes[i]}<text x="160" y="255" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#64748b">LOCAL DEMO PART</text></svg>`;
  const url = await saveFile(`demo/part-${i}.svg`, Buffer.from(svg));
  if (!url) throw new Error("Could not save demo part preview.");
  images.push(url);
}

// title, project index, machine index, current status, quantity, due in days
const parts: Array<[string, number, number | null, string, number, number]> = [
  ["Drive bearing plate", 0, 0, "backlog", 4, -2],
  ["Bumper mounting bracket", 0, 0, "backlog", 8, 0],
  ["Belly pan", 0, 1, "backlog", 2, 2],
  ["Intake side plate", 1, 1, "backlog", 2, 3],
  ["Roller spacer", 1, 2, "backlog", 12, 1],
  ["Sensor mount", 2, null, "backlog", 2, 4],
  ["Cable guide", 2, null, "backlog", 6, 5],
  ["Crossmember tube", 0, 4, "backlog", 4, 2],
  ["Elevator upright", 2, 4, "backlog", 2, 3],
  ["Intake pivot bracket", 1, 5, "backlog", 4, 1],
  ["Encoder cover", 0, 3, "backlog", 4, 6],
  ["Practice field spacer", 1, null, "backlog", 8, 7],
  ["Gearbox mounting plate", 0, 0, "in-progress", 2, -1],
  ["Intake roller hub", 1, 2, "in-progress", 4, 1],
  ["Elevator gusset", 2, 5, "in-progress", 8, 2],
  ["Polycarbonate guard", 1, 1, "in-progress", 2, 3],
  ["Bearing block", 0, 0, "review", 4, 0],
  ["Limit switch bracket", 2, 2, "review", 2, 1],
  ["Chain tensioner", 0, 5, "review", 2, 2],
  ["Wheel spacer", 0, 0, "done", 8, -3],
  ["Roller end cap", 1, 2, "done", 4, -2],
  ["Carriage plate", 2, 1, "done", 2, -1],
  ["Battery tray bracket", 0, 5, "done", 4, -4],
  ["Tube stop", 2, 4, "done", 6, -2],
];
const columns = ["backlog", "in-progress", "review", "done"];
const titles = ["Backlog", "In Progress", "Review", "Done"];
let added = 0;
db.transaction((tx) => {
  for (const member of members)
    tx.insert(schema.users).values(member).onConflictDoNothing().run();
  for (const name of projectNames)
    tx.insert(schema.projects)
      .values({
        id: `demo-project-${name.toLowerCase()}`,
        name,
        created_by: localUser,
      })
      .onConflictDoNothing()
      .run();
  // Respect pre-existing project names, whose ids may differ from the demo ids.
  const projects = tx.select().from(schema.projects).all();
  for (const machine of machines) {
    tx.insert(schema.equipment)
      .values({
        id: `demo-${machine.id}`,
        name: machine.name,
        description: machine.description,
        location: machine.location,
        status: machine.maintenance ? "maintenance" : "active",
        maintenance_note: machine.maintenance
          ? "First-layer adhesion is inconsistent. Clean the plate and calibrate before returning to service."
          : null,
        maintenance_reported_by: machine.maintenance ? "demo-sam" : null,
        maintenance_reported_at: machine.maintenance ? daysAgo(1) : null,
        last_maintenance_at: daysAgo(14),
      })
      .onConflictDoNothing()
      .run();
    tx.insert(schema.equipmentProcesses)
      .values({
        equipment_id: `demo-${machine.id}`,
        process_id: `process-${machine.process}`,
      })
      .onConflictDoNothing()
      .run();
  }
  for (const [
    i,
    [title, project, machineIndex, status, quantity, due],
  ] of parts.entries()) {
    const id = `demo-part-${String(i + 1).padStart(2, "0")}`;
    const machine = machineIndex === null ? null : machines[machineIndex];
    const process = machine?.process ?? "3d-printing";
    const statusIndex = columns.indexOf(status);
    const assignee =
      statusIndex === 0
        ? null
        : members[(i - 12 + members.length * 4) % members.length]
            .onshape_user_id;
    const created = daysAgo(8 + (i % 5));
    const result = tx
      .insert(schema.kanbanCards)
      .values({
        id,
        title,
        column_id: status,
        assignee,
        created_by: i % 3 === 0 ? localUser : "demo-alex",
        project_id: projects.find((p) => p.name === projectNames[project])!.id,
        machine_id: machine ? `demo-${machine.id}` : null,
        queue_position: statusIndex === 0 && machine ? i : null,
        quantity_to_make: quantity,
        due_date: dateIn(due),
        content: `Local demo part. ${process === "3d-printing" ? "Print at 0.2 mm layer height with four walls and 35% infill. Check hole fit before printing the full batch." : "Deburr all edges. Check the critical hole spacing before making the remaining pieces."}`,
        image_url: images[i % images.length],
        onshape_material:
          process === "3d-printing" ? "PETG" : "6061-T6 Aluminum",
        onshape_version_name: "Demo release V3",
        date_created: created,
        date_updated: daysAgo(statusIndex ? 0.25 + (i % 3) : 3),
      })
      .onConflictDoNothing()
      .run();
    if (!result.changes) continue;
    added++;
    tx.insert(schema.kanbanCardProcesses)
      .values({ card_id: id, process_id: `process-${process}` })
      .run();
    for (let step = 0; step <= statusIndex; step++) {
      const actor =
        step === 0
          ? members[1]
          : members.find((m) => m.onshape_user_id === assignee)!;
      tx.insert(schema.statusHistory)
        .values({
          card_id: id,
          card_title: title,
          from_column_id: step ? columns[step - 1] : null,
          to_column_id: columns[step],
          from_status: step ? titles[step - 1] : null,
          to_status: titles[step],
          from_column_index: step ? step - 1 : null,
          to_column_index: step,
          actor_id: actor.onshape_user_id,
          actor_name: actor.name,
          moved_at: step ? daysAgo(4 - step + (i % 3)) : created,
        })
        .run();
    }
    if (i === 14) {
      tx.insert(schema.reviewNotes)
        .values({
          card_id: id,
          author_id: "demo-sam",
          author_name: "Sam Patel",
          text: "Deburr the inside edge and open the mounting holes to 0.257 inches, then send it back for inspection.",
          created_at: daysAgo(0.5),
        })
        .run();
      for (const [from, to, moved] of [
        [1, 2, 0.6],
        [2, 1, 0.5],
      ])
        tx.insert(schema.statusHistory)
          .values({
            card_id: id,
            card_title: title,
            from_column_id: columns[from],
            to_column_id: columns[to],
            from_status: titles[from],
            to_status: titles[to],
            from_column_index: from,
            to_column_index: to,
            actor_id: "demo-sam",
            actor_name: "Sam Patel",
            moved_at: daysAgo(moved),
          })
          .run();
    }
  }
  for (const process of ["cnc-milling", "3d-printing", "hand-tooling"])
    for (const member of members)
      tx.insert(schema.stationRoster)
        .values({
          process_id: `process-${process}`,
          user_id: member.onshape_user_id,
          shop_day: shopDay(),
          added_at: now,
        })
        .onConflictDoNothing()
        .run();
});
console.log(
  `Added ${added} demo parts, with 3 projects, 6 machines, 4 members, station rosters, and status history. Existing records were preserved.`
);
console.log(`Database backup: ${backup}`);
