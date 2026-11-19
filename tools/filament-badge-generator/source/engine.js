// The badge itself: four lines of text and a stepped swatch, built as two watertight solids.
//
// A port of the toolbox CadQuery script (src/badge.py). The measurements are kept exactly: a rounded plate
// 56 x 30 x 3.2, a shallow recess that leaves a rim, four text labels, five thickness steps and a slot cut into
// the underside. Where CadQuery unioned everything into one solid, here the printed top layer — the rim and the
// text together — is its own solid, so in the 3MF the rim and the text share one filament and the body another,
// exactly as the original prints.
//
// Everything is parametric through GEOMETRY and DEFAULTS; leaving them alone reproduces badge.py to the
// millimetre. All the 2D work is Manifold's CrossSection: a rounded rectangle is a smaller rectangle grown
// outwards with a round join, and a glyph is its real outline with its counters.

// Measurements, millimetres, origin at the plate's centre, z = 0 the underside. Straight from badge.py.
export const GEOMETRY = {
  plateW: 56,
  plateH: 30,
  plateD: 3.2,
  plateFillet: 2.5,
  recessW: 54,
  recessH: 28,
  recessFillet: 1.5,
  recessZ: 2.7, // recess floor; the rim runs from here up to the plate top (3.2), so it is 0.5 high
  textSize: 6,
  // The glyphs sit ON the recess floor, the same 0.5 mm band as the rim (2.7 → 3.2), rather than reaching down
  // into the body. That way the body is one filament up to 2.7 and the rim and text the other above it, so the
  // print makes a single colour change instead of swapping back and forth through the embedded letters.
  textRise: 0.5, // extruded height of the glyphs
  textZ: 2.7, // text bottom, resting on the recess floor; the top lands at 3.2, flush with the rim
  step: 6,
  stepCount: 5,
  stepStartX: 22,
  stepY: -8.5,
  stepBase: 0.35, // remaining thickness under the first step
  stepRise: 0.5, // each step adds this to the remaining thickness
  bottomW: 39.2,
  bottomH: 9.5,
  bottomD: 1.8,
  bottomY: 4,
};

// The defaults a fresh window opens with, so it renders a real badge at once. width and textSize match badge.py.
export const DEFAULTS = {
  brand: "Bambu",
  type: "Matte",
  material: "PLA",
  color: "Black",
  temperature: 230,
  steps: true,
  width: GEOMETRY.plateW,
  textSize: GEOMETRY.textSize,
};

// Every linear measurement scales together with the plate width, so the whole badge grows or shrinks in proportion
// and the layout never breaks.
const SCALED = [
  "plateW",
  "plateH",
  "plateD",
  "plateFillet",
  "recessW",
  "recessH",
  "recessFillet",
  "recessZ",
  "textRise",
  "textZ",
  "step",
  "stepStartX",
  "stepY",
  "stepBase",
  "stepRise",
  "bottomW",
  "bottomH",
  "bottomD",
  "bottomY",
];

// Where each label sits and how it lines up, as in badge.py. The top line is brand and type together.
const LABELS = [
  { field: "heading", x: -25, y: 8.5, align: "left" },
  { field: "color", x: -25, y: 0, align: "left" },
  { field: "temperature", x: 25, y: 0, align: "right" },
  { field: "material", x: -25, y: -8.5, align: "left" },
];

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** A glyph path from opentype, flattened to polygons in millimetres, y up (opentype draws y down). */
function pathToPolygons(path, segments = 10) {
  const polygons = [];
  let current = null;
  let start = null;
  let from = null;
  const push = (x, y) => current.push([x, -y]);
  const quad = (p0, c, p1) => {
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const u = 1 - t;
      push(u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]);
    }
  };
  const cubic = (p0, c1, c2, p1) => {
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const u = 1 - t;
      push(
        u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
        u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
      );
    }
  };
  for (const cmd of path.commands) {
    if (cmd.type === "M") {
      if (current && current.length > 2) polygons.push(current);
      current = [];
      start = [cmd.x, cmd.y];
      from = start;
      push(cmd.x, cmd.y);
    } else if (cmd.type === "L") {
      push(cmd.x, cmd.y);
      from = [cmd.x, cmd.y];
    } else if (cmd.type === "Q") {
      quad(from, [cmd.x1, cmd.y1], [cmd.x, cmd.y]);
      from = [cmd.x, cmd.y];
    } else if (cmd.type === "C") {
      cubic(from, [cmd.x1, cmd.y1], [cmd.x2, cmd.y2], [cmd.x, cmd.y]);
      from = [cmd.x, cmd.y];
    } else if (cmd.type === "Z") {
      if (current && current.length > 2) polygons.push(current);
      current = null;
      from = start;
    }
  }
  if (current && current.length > 2) polygons.push(current);
  return polygons;
}

function bounds(polygons) {
  const min = [Infinity, Infinity];
  const max = [-Infinity, -Infinity];
  for (const polygon of polygons)
    for (const [x, y] of polygon) {
      min[0] = Math.min(min[0], x);
      min[1] = Math.min(min[1], y);
      max[0] = Math.max(max[0], x);
      max[1] = Math.max(max[1], y);
    }
  return { min, max };
}

const shift = (polygons, dx, dy) => polygons.map((polygon) => polygon.map(([x, y]) => [x + dx, y + dy]));

/** One label's polygons, moved so its anchor lands on the target, centred vertically — the badge.py alignment. */
function placeLabel(font, text, size, { x, y, align }) {
  const polygons = pathToPolygons(font.getPath(text, 0, 0, size));
  if (!polygons.length) return [];
  const box = bounds(polygons);
  const anchorX = align === "right" ? box.max[0] : box.min[0];
  return shift(polygons, x - anchorX, y - (box.min[1] + box.max[1]) / 2);
}

/** The flat vertices (x, y, z triples) and triangles of a Manifold solid, from its mesh. */
function meshArrays(solid) {
  const mesh = solid.getMesh();
  const vertices = new Float32Array((mesh.vertProperties.length / mesh.numProp) * 3);
  for (let i = 0, v = 0; i < mesh.vertProperties.length; i += mesh.numProp, v += 3) {
    vertices[v] = mesh.vertProperties[i];
    vertices[v + 1] = mesh.vertProperties[i + 1];
    vertices[v + 2] = mesh.vertProperties[i + 2];
  }
  return { vertices, triangles: new Uint32Array(mesh.triVerts) };
}

/**
 * Builds the badge. `api` is Manifold's `{ CrossSection, Manifold }`, `font` an opentype font, `input` the fields
 * and any geometry overrides. Returns the body and the rim-and-text as separate solids with their meshes, named so
 * the 3MF assigns each its own filament, and the overall size.
 */
export function buildBadge(api, font, input = {}) {
  const { CrossSection: C, Manifold: M } = api;
  const s = { ...DEFAULTS, ...input };
  const g = { ...GEOMETRY, ...(input.geometry ?? {}) };
  const scale = Math.max(0.3, (Number(s.width) || GEOMETRY.plateW) / GEOMETRY.plateW);
  for (const key of SCALED) g[key] *= scale;
  g.textSize = Math.max(1, Number(s.textSize) || GEOMETRY.textSize * scale);
  const labels = LABELS.map((label) => ({ ...label, x: label.x * scale, y: label.y * scale }));
  const heading = [String(s.brand ?? "").trim(), String(s.type ?? "").trim()].filter(Boolean).join(" ");
  const values = {
    heading,
    material: String(s.material ?? "")
      .trim()
      .toUpperCase(),
    color: String(s.color ?? "")
      .trim()
      .toLowerCase(),
    temperature: `${Math.round(Number(s.temperature) || 0)}\u00b0C`,
  };

  const rubbish = [];
  const keep = (x) => (rubbish.push(x), x);

  try {
    const roundedRect = (w, h, r) => {
      const base = keep(C.square([Math.max(0.01, w - 2 * r), Math.max(0.01, h - 2 * r)], true));
      return r > 0 ? keep(base.offset(r, "Round", 2, 64)) : base;
    };

    const plateSection = roundedRect(g.plateW, g.plateH, g.plateFillet);
    const recessSection = roundedRect(g.recessW, g.recessH, g.recessFillet);

    // The body is a clean slab up to the recess floor (z = 2.7); the raised rim and the text form the top 0.5 mm
    // layer above it. Building the body this way — rather than sinking a recess into a full-height plate — leaves no
    // numerical sliver at the recess edge, and keeps the body a single colour up to one height.
    const rimHeight = g.plateD - g.recessZ;
    const rim = keep(keep(keep(plateSection.subtract(recessSection)).extrude(rimHeight)).translate([0, 0, g.recessZ]));

    let plate = keep(plateSection.extrude(g.recessZ));

    // Five thickness steps: each box leaves the material below its underside standing.
    if (s.steps) {
      for (let i = 0; i < g.stepCount; i++) {
        const dz = g.stepBase + i * g.stepRise;
        const cut = keep(
          keep(M.cube([g.step, g.step, g.step], false)).translate([
            g.stepStartX - i * g.step - g.step / 2,
            g.stepY - g.step / 2,
            dz,
          ]),
        );
        plate = keep(plate.subtract(cut));
      }
    }

    // Slot on the underside.
    plate = keep(
      plate.subtract(
        keep(
          keep(M.cube([g.bottomW, g.bottomH, g.bottomD], false)).translate([
            -g.bottomW / 2,
            g.bottomY - g.bottomH / 2,
            0,
          ]),
        ),
      ),
    );

    // Text as one solid, each label placed as in the original (positions scaled with the plate).
    const labelPolys = [];
    for (const label of labels) {
      const text = values[label.field];
      if (text) labelPolys.push(...placeLabel(font, text, g.textSize, label));
    }

    let top = rim;
    if (labelPolys.length) {
      const section = keep(new C(labelPolys, "EvenOdd"));
      if (!section.isEmpty()) {
        // The letters rest on the recess floor (z = 2.7) rather than reaching into the body, so the rim and the
        // text form one 0.5 mm top layer in the second filament and the print changes colour only once.
        const textSolid = keep(keep(section.extrude(g.textRise)).translate([0, 0, g.textZ]));
        top = keep(M.union([rim, textSolid]));
      }
    }

    if (plate.volume() < 1) throw fail("empty", "The plate came out empty.");

    const models = [
      { name: "plate", slot: 0, ...meshArrays(plate) },
      { name: "rim-and-text", slot: 1, ...meshArrays(top) },
    ];

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const model of models)
      for (let i = 0; i < model.vertices.length; i += 3)
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], model.vertices[i + k]);
          max[k] = Math.max(max[k], model.vertices[i + k]);
        }

    return {
      models,
      size: max.map((v, i) => v - min[i]),
      bounds: { min, max },
      manifold: models.every((model) => model.triangles.length > 0),
    };
  } finally {
    for (const object of new Set(rubbish.reverse())) {
      try {
        object.delete();
      } catch {
        // already freed
      }
    }
  }
}

/** The download name: `{brand}_{type}_{material}_{color}_badge.<ext>`, lowercased, spaces to underscores. */
export function badgeFileName(input, extension = "3mf") {
  const part = (value) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
  const stem = [input.brand, input.type, input.material, input.color].map(part).filter(Boolean).join("_");
  return `${stem || "filament"}_badge.${extension}`;
}
