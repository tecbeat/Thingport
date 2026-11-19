// Tests for the filament badge generator. Run from the tool's folder:
//   node source/test_badge.mjs
//
// The file writers and the download name are pure and always run. The engine needs a real font parser and a real
// solid modeller, which Thingport carries in the frontend; that part runs when the frontend's packages are
// installed and says it skipped them when they aren't, so the check stays honest about what it proved.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { badgeFileName, buildBadge } from "./engine.js";
import { stl, threeMf } from "./files.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../../..");

let passed = 0;
let skipped = 0;
const failures = [];
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
  } catch (error) {
    failures.push(name);
    console.error(`✗ ${name}\n  ${error.message}`);
  }
};
const near = (actual, expected, tolerance, what) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} not within ${tolerance} of ${expected}`);

const fakeModels = [
  {
    name: "plate",
    slot: 0,
    vertices: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
    triangles: new Uint32Array([0, 1, 2]),
  },
  {
    name: "rim-and-text",
    slot: 1,
    vertices: new Float32Array([0, 0, 1, 5, 0, 1, 0, 5, 1]),
    triangles: new Uint32Array([0, 1, 2]),
  },
];

await test("the download name carries brand, type, material and colour", () => {
  assert.equal(
    badgeFileName({ brand: "Bambu", type: "Matte", material: "PLA", color: "Black" }, "3mf"),
    "bambu_matte_pla_black_badge.3mf",
  );
});

await test("the 3MF is a zip with the expected parts", async () => {
  const bytes = await threeMf(fakeModels, ["#2E3440", "#E5E9F0"], { title: "Test" });
  assert.ok(bytes instanceof Uint8Array && bytes.length > 0, "it produced bytes");
  assert.equal(bytes[0], 0x50, "it starts with the zip magic PK");
  assert.equal(bytes[1], 0x4b, "it starts with the zip magic PK");
});

await test("the STL header counts every triangle", () => {
  const bytes = stl(fakeModels, { title: "Test" });
  const view = new DataView(bytes.buffer);
  assert.equal(bytes.length, 84 + 2 * 50, "one triangle per model");
  assert.equal(view.getUint32(80, true), 2, "the count in the header");
});

// ---- the SDK contract: every SDK call the script makes must exist on the SDK ------------------------------------
// This is what would have caught `collections.pickCollection` (the picker is `collections.pick` / `ui.pickCollection`):
// the member names are read from the SDK's own type definitions, so a typo or a call on the wrong object fails here.

/** The members an interface declares, by reading its body in the .d.ts (two-space indented names). */
function interfaceMembers(dts, name) {
  const marker = `interface ${name} `;
  const at = dts.indexOf(marker);
  if (at < 0) return new Set();
  let i = dts.indexOf("{", at);
  let depth = 0;
  let end = -1;
  for (; i < dts.length; i++) {
    if (dts[i] === "{") depth++;
    else if (dts[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  const body = dts.slice(dts.indexOf("{", at) + 1, end);
  const members = new Set();
  for (const match of body.matchAll(/^ {2}(?:readonly |get |set )?(\w+)\??\s*[(<:]/gm)) members.add(match[1]);
  return members;
}

await test("every SDK call in ui.js exists on the Thingport SDK", () => {
  const dtsPath = path.join(repository, "docs/developers/examples/thingport.d.ts");
  const dts = fs.readFileSync(dtsPath, "utf8");
  const surface = {
    thingport: new Set([...interfaceMembers(dts, "ToolSdk"), ...interfaceMembers(dts, "SdkBase")]),
    collections: new Set([...interfaceMembers(dts, "ToolCollections"), ...interfaceMembers(dts, "SdkCollections")]),
    ui: new Set([...interfaceMembers(dts, "ToolUi"), ...interfaceMembers(dts, "SdkUi")]),
    models: interfaceMembers(dts, "SdkModels"),
    storage: interfaceMembers(dts, "SdkStorage"),
    shared: interfaceMembers(dts, "SdkShared"),
  };
  for (const [object, members] of Object.entries(surface))
    assert.ok(members.size > 0, `read no members for ${object} — the .d.ts shape changed`);

  const source = fs.readFileSync(path.join(here, "ui.js"), "utf8");
  const bad = [];
  for (const [object, members] of Object.entries(surface)) {
    for (const match of source.matchAll(new RegExp(`\\b${object}\\.(\\w+)`, "g"))) {
      if (!members.has(match[1])) bad.push(`${object}.${match[1]}`);
    }
  }
  assert.deepEqual(bad, [], `ui.js calls SDK members that don't exist: ${bad.join(", ")}`);
});

// ---- the engine, when the libraries are here --------------------------------------------------------------------

const frontend = path.join(repository, "frontend");
const load = async (file) => {
  const module = await import(pathToFileURL(path.join(frontend, "node_modules", file)).href);
  return module.default ?? module;
};

let engine = null;
try {
  const [opentype, Manifold] = await Promise.all([
    load("opentype.js/dist/opentype.mjs"),
    load("manifold-3d/manifold.js"),
  ]);
  const api = await Manifold();
  api.setup();
  const data = fs.readFileSync(path.join(frontend, "src/assets/toolFonts/pt-sans.ttf"));
  const font = opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.length));
  engine = { api: { CrossSection: api.CrossSection, Manifold: api.Manifold }, font };
} catch (error) {
  skipped = 1;
  console.log(`  (the engine's own tests need the frontend's packages: ${error.message})`);
}

if (engine) {
  const { api, font } = engine;
  const run = (input) => buildBadge(api, font, input);

  await test("the badge comes out at the plate's nominal size", () => {
    const built = run({ brand: "Bambu", type: "Matte", material: "PLA", color: "black", temperature: 230 });
    near(built.size[0], 56, 0.2, "width");
    near(built.size[1], 30, 0.2, "depth");
    near(built.size[2], 3.2, 0.05, "height");
  });

  await test("the body and the rim-and-text are two separate solids", () => {
    const built = run({ brand: "Bambu", type: "Matte", material: "PLA", color: "black", temperature: 230 });
    assert.equal(built.models.length, 2, "a plate and a rim-and-text part");
    assert.equal(built.models[0].name, "plate");
    assert.equal(built.models[1].name, "rim-and-text");
    assert.equal(built.models[1].slot, 1, "the rim and text take the second filament");
    assert.ok(built.manifold, "both parts have triangles");
  });

  await test("the badge scales to the width asked for and stays sound", () => {
    const built = run({ brand: "Bambu", type: "Matte", material: "PLA", color: "black", temperature: 230, width: 112 });
    near(built.size[0], 112, 0.5, "width");
    near(built.size[1], 60, 0.5, "depth");
    near(built.size[2], 6.4, 0.1, "height");
    assert.equal(built.models.length, 2, "still two parts");
    assert.ok(built.manifold, "still manifold at double size");
  });

  await test("the thickness steps can be turned off", () => {
    const withSteps = run({ brand: "B", type: "", material: "PLA", color: "x", temperature: 230, steps: true });
    const without = run({ brand: "B", type: "", material: "PLA", color: "x", temperature: 230, steps: false });
    assert.ok(without.models[0].triangles.length < withSteps.models[0].triangles.length, "fewer cuts, fewer triangles");
  });

  await test("empty text still leaves the plate and the rim", () => {
    const built = run({ brand: "", type: "", material: "", color: "", temperature: 230 });
    assert.equal(built.models.length, 2, "the plate and the rim are always there");
  });
}

console.log(
  `\n${passed} passed${skipped ? ", engine tests skipped" : ""}${failures.length ? `, ${failures.length} failed` : ""}`,
);
if (failures.length) process.exit(1);
