import { createLucideIcon, Cog, type LucideIcon } from "lucide-react";

/**
 * Manufacturing process icons, drawn on Lucide's grid (24×24, 2px stroke,
 * round caps and joins, stroke = currentColor) so they size and style like
 * every other lucide-react icon in the app. Design canvas:
 * https://claude.ai/artifact/2VkeTK88DK9jhC85XyFv5L
 */
type Node = Parameters<typeof createLucideIcon>[1];

const icon = (name: string, node: Node) =>
  createLucideIcon(
    name,
    node.map(([tag, attrs, ...rest], i) => [
      tag,
      { ...attrs, key: `${name}-${i}` },
      ...rest,
    ]) as Node
  );

const path = (d: string): Node[number] => ["path", { d }];
const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  rx: number
): Node[number] => ["rect", { x, y, width, height, rx }];
/** The laser sheet, cut arc and beam spot shared by the three laser icons. */
const laserBase: Node = [
  rect(3, 3, 18, 18, 2),
  path("M12 7a5 5 0 1 1-5 5"),
  ["path", { d: "M7 12h.01", strokeWidth: 4 }],
];

/**
 * lucide-react renders only top-level nodes (no <g> children), so a tilted
 * icon carries its rotation on every shape instead.
 */
const rotated = (deg: number, node: Node): Node =>
  node.map(([tag, attrs]) => [
    tag,
    { ...attrs, transform: `rotate(${deg} 12 12)` },
  ]) as Node;

export const CncMilling = icon(
  "cnc-milling",
  rotated(45, [
    rect(10.5, 2, 3, 7, 1),
    rect(9.5, 9, 5, 12, 1.5),
    path("M9.5 12.5l5-2"),
    path("M9.5 16l5-2"),
    path("M9.5 19.5l5-2"),
  ])
);

export const ThreeDPrinting = icon("3d-printing", [
  path("M3 3h18"),
  path("M9 3v4h6V3"),
  path("M10 7l2 3 2-3"),
  path("M7 21v-6h10v6"),
  path("M7 18h10"),
  path("M3 21h18"),
]);

export const HandTooling = icon("hand-tooling", [
  rect(4, 3, 13, 5, 1),
  path("M17 4h2a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1h-2"),
  rect(9, 8, 4, 13, 1),
]);

export const Measuring = icon("measuring", [
  path("M11 5H4a1 1 0 0 0-1 1v13l3-3V9h5"),
  rect(11, 4, 5, 6, 1),
  path("M12 10v9l3-3v-6"),
  path("M16 5h5a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-5"),
]);

export const PowerTooling = icon("power-tooling", [
  rect(3, 5, 13, 7, 2),
  path("M16 7h3v3h-3"),
  path("M19 8.5h3"),
  path("M7 12l-1 5h5l1-5"),
  rect(4, 17, 9, 4, 1),
]);

export const SafetyEquipment = icon("safety-equipment", [
  path(
    "M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a3 3 0 0 1-3 3h-2.5a2 2 0 0 1-1.6-.8L12 14l-.9 1.2a2 2 0 0 1-1.6.8H6a3 3 0 0 1-3-3z"
  ),
  path("M3 10H2"),
  path("M21 10h1"),
]);

export const LaserCutting = icon("laser-cutting", laserBase);

/** Diagonal section hatching on the cut-out piece: metal. */
export const FiberLaser = icon("laser-fiber", [
  ...laserBase,
  path("M10 13l3-3"),
  path("M11.8 15.2l3.4-3.4"),
]);

/** Wood-grain lines on the cut-out piece: wood and plastic. */
export const Co2Laser = icon("laser-co2", [
  ...laserBase,
  path("M10 11c1-1 1.5 1 2.5 0s1.5-1 2.5 0"),
  path("M10 14c1-1 1.5 1 2.5 0s1.5-1 2.5 0"),
]);

export const PressBrake = icon("press-brake", [
  path("M5 3h14"),
  path("M9 3v8l3 4 3-4V3"),
  path("M2 12l6 2 4 3 4-3 6-2"),
  path("M3 21v-5h5l4 4 4-4h5v5z"),
]);

export const Lathe = icon("lathe", [
  rect(2, 6, 4, 12, 1),
  path("M6 9h8v2h7v2h-7v2H6"),
  path("M16 13l-1.5 8h4.5z"),
]);

export const CncRouter = icon("cnc-router", [
  path("M5 18V5h14v13"),
  path("M5 8h14"),
  rect(10, 8, 4, 5, 1),
  path("M12 13v2"),
  rect(2, 18, 20, 3, 1),
]);

export const Waterjet = icon("waterjet", [
  path("M12 2s-5 5.5-5 9a5 5 0 0 0 10 0c0-3.5-5-9-5-9z"),
  path("M3 18h7v3H3z"),
  path("M14 18h7v3h-7z"),
]);

export const DrillPress = icon("drill-press", [
  path("M3 21h10"),
  path("M6 21V8"),
  rect(4, 3, 15, 5, 1),
  path("M15 8v6"),
  path("M6 17h12"),
]);

export const Tapping = icon("tapping", [
  path("M3 4h18"),
  path("M12 4v3"),
  path("M10 7h4v12l-2 2-2-2z"),
  path("M10 11l4-1.5"),
  path("M10 14.5l4-1.5"),
  path("M10 18l4-1.5"),
]);

export const Sawing = icon("sawing", [
  path("M3 11V6h18v5"),
  path(
    "M3 11l1.5 2L6 11l1.5 2L9 11l1.5 2L12 11l1.5 2L15 11l1.5 2L18 11l1.5 2L21 11"
  ),
  path("M5 21v-4h14v4"),
]);

export const Riveting = icon("riveting", [
  path("M12 2v5"),
  path("M8 10a4 3 0 0 1 8 0z"),
  path("M3 13h7"),
  path("M14 13h7"),
  path("M3 16h7"),
  path("M14 16h7"),
  path("M10 10v9"),
  path("M14 10v9"),
  path("M10 19l-1 2h6l-1-2"),
]);

export const Deburring = icon(
  "deburring",
  rotated(-45, [
    rect(10, 11, 4, 11, 2),
    path("M12 11V6"),
    path("M12 6V4.5a2 2 0 0 1 4 0V6"),
  ])
);

/** A hex nut seen from the end. */
export const Fastening = icon("fastening", [
  path("M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"),
  ["circle", { cx: 12, cy: 12, r: 3.5 }],
]);

/** Bar stock stacked for prep. */
export const MaterialProcessing = icon("material-processing", [
  rect(3, 15, 18, 5, 1),
  rect(5, 9, 14, 5, 1),
  rect(7, 3, 10, 5, 1),
]);

/**
 * Icon for each seeded process, keyed by the id after `process-`, with the
 * names a team might have typed for the same process before it was seeded.
 */
const PROCESS_ICONS: Array<{
  key: string;
  icon: LucideIcon;
  names: string[];
}> = [
  {
    key: "cnc-milling",
    icon: CncMilling,
    names: ["cnc milling", "milling", "mill", "cnc mill"],
  },
  {
    key: "3d-printing",
    icon: ThreeDPrinting,
    names: ["3d printing", "3d print", "printing", "additive"],
  },
  {
    key: "hand-tooling",
    icon: HandTooling,
    names: ["hand tooling", "hand tools"],
  },
  {
    key: "measuring",
    icon: Measuring,
    names: ["measuring", "inspection", "measurement"],
  },
  {
    key: "power-tooling",
    icon: PowerTooling,
    names: ["power tooling", "power tools"],
  },
  {
    key: "safety-equipment",
    icon: SafetyEquipment,
    names: ["safety equipment", "safety"],
  },
  {
    key: "laser-cutting",
    icon: LaserCutting,
    names: ["laser cutting", "laser", "laser cutter"],
  },
  {
    key: "laser-fiber",
    icon: FiberLaser,
    names: ["fiber laser", "fiber laser cutting"],
  },
  {
    key: "laser-co2",
    icon: Co2Laser,
    names: ["co2 laser", "co2 laser cutting"],
  },
  {
    key: "press-brake",
    icon: PressBrake,
    names: ["press brake", "bending", "sheet metal bending", "brake"],
  },
  { key: "lathe", icon: Lathe, names: ["lathe", "turning"] },
  {
    key: "cnc-router",
    icon: CncRouter,
    names: ["cnc router", "router", "routing"],
  },
  { key: "waterjet", icon: Waterjet, names: ["waterjet", "water jet"] },
  { key: "drill-press", icon: DrillPress, names: ["drill press", "drilling"] },
  { key: "tapping", icon: Tapping, names: ["tapping", "threading"] },
  {
    key: "sawing",
    icon: Sawing,
    names: ["sawing", "bandsaw", "band saw", "cutoff", "chop saw"],
  },
  { key: "riveting", icon: Riveting, names: ["riveting", "rivets", "rivet"] },
  {
    key: "deburring",
    icon: Deburring,
    names: ["deburring", "deburr", "finishing"],
  },
  {
    key: "fastening",
    icon: Fastening,
    names: ["fastening", "assembly", "fasteners", "hardware"],
  },
  {
    key: "material-processing",
    icon: MaterialProcessing,
    names: ["material processing", "material prep", "stock", "raw material"],
  },
  { key: "other", icon: Cog, names: ["other"] },
];

const byKey = new Map(PROCESS_ICONS.map((entry) => [entry.key, entry.icon]));
const byName = new Map(
  PROCESS_ICONS.flatMap((entry) => entry.names.map((n) => [n, entry.icon]))
);

const normalize = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The icon for a process: by seeded id first, then by name, so a process the
 * team created by hand (random id) still gets the matching icon. Anything
 * unrecognised (and the seeded "Other") gets a generic cog.
 */
export function processIcon(process: { id: string; name: string }): LucideIcon {
  const key = process.id.startsWith("process-")
    ? process.id.slice("process-".length)
    : null;
  return (key && byKey.get(key)) || byName.get(normalize(process.name)) || Cog;
}
