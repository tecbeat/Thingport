// The window: the form, the live preview, and the two ways out — a download or a model in the library.
//
// Building the badge is a few milliseconds, so the preview is rebuilt as the user types, debounced, and the window
// opens on a finished badge from the defaults. A failure is shown in a toast and never leaves a button stuck,
// which is the bug the original badge.py guarded against.

import { arimoBoldBytes } from "./arimo.js";
import { buildBadge, badgeFileName, DEFAULTS } from "./engine.js";
import { threeMf } from "./files.js";
import { createViewer } from "./viewer.js";

// The default typeface: Arimo Bold is metric-compatible with Arial, so it matches the original badge.py exactly.
const ARIMO_ID = "__arimo-bold";

/** @param {import("../thingport").ToolSdk} thingport */
export default async function mount(thingport) {
  const { root, storage, models, collections, ui, t, labels, theme } = thingport;
  labels();

  const $ = (selector) => root.querySelector(selector);

  // The tool's own CSS variables, from Thingport's theme, so the window matches the rest of the app in either theme.
  const shell = $(".fbg") ?? root;
  const themeVars = {
    bg: theme.background,
    panel: theme.paper,
    divider: theme.divider,
    text: theme.text,
    muted: theme.textSecondary,
    accent: theme.primary,
    "accent-ink": theme.primaryContrast ?? "#ffffff",
    danger: theme.error,
    font: theme.fontFamily,
  };
  for (const [name, value] of Object.entries(themeVars)) shell.style.setProperty(`--${name}`, value);

  const brand = $(".fbg-brand");
  const type = $(".fbg-type");
  const material = $(".fbg-material");
  const colour = $(".fbg-color");
  const width = $(".fbg-width");
  const temperature = $(".fbg-temp");
  const textSize = $(".fbg-textsize");
  const steps = $(".fbg-steps");
  const fontSelect = $(".fbg-font");
  const plateColour = $(".fbg-plate-colour");
  const textColour = $(".fbg-text-colour");
  const downloadButton = $(".fbg-download");
  const saveButton = $(".fbg-save");
  const status = $(".fbg-status");
  const sizeOut = $(".fbg-size");
  const canvas = $(".fbg-canvas");

  const read = () => ({
    brand: brand.value,
    type: type.value,
    material: material.value,
    color: colour.value,
    width: Math.min(160, Math.max(24, Number(width.value) || DEFAULTS.width)),
    temperature: Math.min(350, Math.max(150, Number(temperature.value) || 230)),
    textSize: Math.min(16, Math.max(2, Number(textSize.value) || DEFAULTS.textSize)),
    steps: steps.checked,
  });
  const ready = () => Boolean(brand.value.trim() && material.value.trim() && colour.value.trim());

  const [{ CrossSection, Manifold }, fonts, opentype] = await Promise.all([
    thingport.library("manifold"),
    thingport.library("fonts"),
    thingport.library("opentype"),
  ]);
  const api = { CrossSection, Manifold };

  // Arimo Bold, bundled with the tool, comes first and is the default — it is metric-compatible with Arial, so the
  // badge matches the original. Every Thingport font follows it, loaded only when picked.
  const arimo = opentype.parse(arimoBoldBytes());
  const loadFont = (id) => (id === ARIMO_ID ? Promise.resolve(arimo) : fonts.load(id));
  const addOption = (value, label) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    fontSelect.append(option);
  };
  addOption(ARIMO_ID, t("font.arimo"));
  for (const font of fonts.list) addOption(font.id, font.name);
  const isKnownFont = (id) => id === ARIMO_ID || fonts.list.some((f) => f.id === id);

  const stored = (await storage.get("last")) ?? {};
  brand.value = stored.brand ?? DEFAULTS.brand;
  type.value = stored.type ?? DEFAULTS.type;
  material.value = stored.material ?? DEFAULTS.material;
  colour.value = stored.color ?? DEFAULTS.color;
  width.value = String(stored.width ?? DEFAULTS.width);
  temperature.value = String(stored.temperature ?? DEFAULTS.temperature);
  textSize.value = String(stored.textSize ?? DEFAULTS.textSize);
  steps.checked = stored.steps ?? DEFAULTS.steps;
  fontSelect.value = isKnownFont(stored.fontId) ? stored.fontId : ARIMO_ID;
  plateColour.value = stored.plateColour ?? "#2E3440";
  textColour.value = stored.textColour ?? "#E5E9F0";

  let font = await loadFont(fontSelect.value);
  const viewer = createViewer(await thingport.library("three"), canvas);
  if (!viewer) $(".fbg-stage").classList.add("fbg-no-webgl");

  let latest = null;
  const colourOf = (model) => (model.slot === 1 ? textColour.value : plateColour.value);

  const rebuild = (fit = false) => {
    let result;
    try {
      result = buildBadge(api, font, read());
    } catch (error) {
      latest = null;
      status.textContent = t("buildFailed", { reason: error.message });
      viewer?.clear();
      updateButtons();
      return;
    }
    latest = result;
    viewer?.show(result.models, { colourOf, fit });
    const [w, d, h] = result.size.map((value) => value.toFixed(1));
    sizeOut.textContent = t("size", { w, d, h });
    status.textContent = ready() ? t("ready") : t("need");
    updateButtons();
  };

  function updateButtons() {
    const can = Boolean(latest) && ready();
    downloadButton.disabled = !can;
    saveButton.disabled = !can;
  }

  const persist = () =>
    storage.set("last", {
      ...read(),
      fontId: fontSelect.value,
      plateColour: plateColour.value,
      textColour: textColour.value,
    });

  let timer = 0;
  const debounced = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      rebuild(false);
      void persist();
    }, 180);
  };

  for (const field of [brand, type, material, colour, temperature, textSize])
    field.addEventListener("input", debounced);
  // Resizing the badge scales the default text with it, so the layout stays in proportion; the user can still
  // override the text size afterwards.
  width.addEventListener("input", () => {
    const scale = Math.min(160, Math.max(24, Number(width.value) || DEFAULTS.width)) / DEFAULTS.width;
    textSize.value = String(Math.round(DEFAULTS.textSize * scale * 2) / 2);
    debounced();
  });
  steps.addEventListener("change", () => {
    rebuild(false);
    void persist();
  });
  for (const picker of [plateColour, textColour])
    picker.addEventListener("input", () => {
      if (latest) viewer?.show(latest.models, { colourOf, fit: false });
      void persist();
    });
  fontSelect.addEventListener("change", async () => {
    font = await loadFont(fontSelect.value);
    rebuild(false);
    void persist();
  });

  const title = () => {
    const name = [brand.value.trim(), type.value.trim()].filter(Boolean).join(" ");
    return colour.value.trim() ? `${name} \u2013 ${colour.value.trim()}` : name || t("name");
  };

  downloadButton.addEventListener("click", async () => {
    if (!latest || !ready()) return;
    downloadButton.disabled = true;
    try {
      const data = await threeMf(latest.models, [plateColour.value, textColour.value], { title: title() });
      const name = badgeFileName(read(), "3mf");
      thingport.download({ name, data });
      ui.toast(t("downloaded", { name }), "success");
    } catch (error) {
      ui.toast(t("buildFailed", { reason: error.message }), "error");
    } finally {
      updateButtons();
    }
  });

  saveButton.addEventListener("click", async () => {
    if (!latest || !ready()) return;
    saveButton.disabled = true;
    const label = saveButton.textContent;
    saveButton.textContent = t("saving");
    try {
      const collection = await collections.pick({ title: t("saveWhere") });
      if (!collection) return;
      const data = await threeMf(latest.models, [plateColour.value, textColour.value], { title: title() });
      const model = await models.create({
        name: title(),
        description: t("madeBy"),
        tags: ["filament", "swatch", material.value.trim().toLowerCase()].filter(Boolean),
        collectionId: collection.id,
        files: [{ name: badgeFileName(read(), "3mf"), data }],
      });
      const cover = await viewer?.toBlob("image/png");
      if (cover) {
        try {
          await models.addImages(model.id, [{ name: "preview.png", data: cover, type: "image/png" }]);
        } catch {
          // a missing cover is not worth failing the save over
        }
      }
      ui.toast(t("saved", { name: model.name }), "success", { openModel: model.id });
    } catch (error) {
      ui.toast(t("saveFailed", { reason: error.message }), "error");
    } finally {
      saveButton.textContent = label;
      updateButtons();
    }
  });

  rebuild(true);

  return () => {
    clearTimeout(timer);
    viewer?.dispose();
  };
}
