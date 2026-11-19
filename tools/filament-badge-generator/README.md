# Filament badge generator

Makes a small printable filament swatch — a rounded plate carrying a brand, material, colour and nozzle
temperature, with five thickness steps (0.35 / 0.85 / 1.35 / 1.85 / 2.35 mm) for judging how a filament prints at
different layer counts, and a slot on the underside. It is a browser port of the toolbox CadQuery script
(`tecbeat/toolbox`, `src/badge.py`); the measurements are kept exactly (plate 56 × 30 × 3.2 mm).

## What it does

- Builds the badge with [Manifold](https://manifoldcad.org/) so the mesh is watertight, and draws a live
  two-colour preview with Thingport's Three.js.
- The default typeface is **Arimo Bold**, bundled with the tool. Arimo is metric-compatible with Arial, so the
  badge matches the original `badge.py` (which used Arial Bold) exactly, without shipping a proprietary font. Every
  Thingport font is available too, and the text size is adjustable while the default stays true to the original.
- Text outlines come from the chosen typeface via opentype.js.
- **Download 3MF** writes the plate and the text as two parts in one assembly, each assigned its own extruder, so
  Bambu Studio and OrcaSlicer open it ready to print in two colours. The file is named
  `{brand}_{material}_{colour}_badge.3mf`.
- **Save to library…** asks for a collection and stores the badge there as a model, with the preview as its cover.
- Your last entries (brand, material, colour, temperature, font and the two colours) are remembered per user with
  `thingport.storage`.

## Network and models

- **It reaches no hosts.** `hosts` is empty; everything runs in the browser.
- **It brings no models.** Nothing is imported; every badge is generated from your input.

## Bundled font

`source/arimo.js` embeds a subset of **Arimo** (wght=700 / Bold), © The Arimo Project Authors, licensed under the
[SIL Open Font License 1.1](https://openfontlicense.org/). It is instanced and subset from
[google/fonts `ofl/arimo`](https://github.com/google/fonts/tree/main/ofl/arimo). Arimo is not Arial; it is a
metric-compatible open substitute, which is why the badge looks the same without shipping Arial.

## Building it

The script is built from `source/`:

```sh
node source/build.mjs      # writes tool.js and tool.json
node source/test_badge.mjs # file writers always; the engine when the frontend's packages are installed
```
