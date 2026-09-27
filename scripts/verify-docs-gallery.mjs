/**
 * Live verification of the REAL docs-gallery configs — the ones the docs
 * site serves — in a real browser with network access.
 *
 * The hermetic twins (e2e/gallery.spec.ts) prove the render mechanism in
 * CI; this sweep proves the published pages: remote basemap, remote data,
 * real glyphs. It exists because two docs pages shipped broken while the
 * hermetic suite was green (ml-blj's named-url pages; the empty attribution
 * control) — failure classes only the live environment exhibits.
 *
 * Not part of CI (remote services would make a required check flaky). Run
 * before a release or after gallery changes:
 *
 *   node e2e/server.mjs &        # serves the repo, incl. docs configs
 *   node scripts/verify-docs-gallery.mjs
 *
 * Exits non-zero listing every page that fails its expectations:
 *  - no page/console errors, no ml-map:error events
 *  - every document layer present in the style
 *  - layers with feature-backed sources put real features on screen (qRF)
 *  - declared controls exist in the DOM — and the attribution control has
 *    visible text (an empty attribution control collapses: the exact bug
 *    this sweep was built after)
 */
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

// `yaml` lives in packages/core's dependency tree, not the workspace root.
const require = createRequire(new URL("../packages/core/package.json", import.meta.url));
const { parse: parseYAML } = require("yaml");

const BASE = process.env.VERIFY_BASE ?? "http://localhost:4174";
const CONFIG_DIR = "docs/public/configs/gallery";

// Layer types qRF can meaningfully assert on (raster/hillshade/background
// are not feature-queryable; symbol labels depend on glyph rendering, which
// IS part of what we want to prove live, so symbols are included).
const QUERYABLE = new Set(["circle", "line", "fill", "fill-extrusion", "symbol", "heatmap"]);
// Heatmap draws a density surface; qRF support varies — presence is enough.
QUERYABLE.delete("heatmap");

// Configs that cannot render without page JS registering a protocol — the
// sweep drives bare configs through the raw viewer, which has no page JS.
// Each entry names its replacement regression test so nothing is silently
// untested; every skip is printed in the run output.
const PROTOCOL_PAGES = new Map([
  [
    "pmtiles-source-and-protocol",
    "needs the page's pmtiles protocol registration; hermetic twin covers the hatch (e2e/gallery-hatch.spec.ts)",
  ],
]);

const slugs = readdirSync(CONFIG_DIR)
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => f.replace(/\.yaml$/, ""))
  .sort();

const browser = await chromium.launch();
const failures = [];

for (const slug of slugs) {
  if (PROTOCOL_PAGES.has(slug)) {
    console.log(`SKIP ${slug} — ${PROTOCOL_PAGES.get(slug)}`);
    continue;
  }
  const doc = parseYAML(readFileSync(`${CONFIG_DIR}/${slug}.yaml`, "utf8"));
  const layers = doc.layers ?? [];
  const layerIds = layers.map((l) => l.id);
  const initialZoom = doc.config?.zoom ?? 0;
  const queryable = layers
    .filter((l) => QUERYABLE.has(l.type))
    // A layer whose minzoom is above the initial camera is invisible BY
    // DESIGN at page load (e.g. the heatmap page's zoom-gated circles).
    .filter((l) => (l.minzoom ?? 0) <= initialZoom)
    .map((l) => l.id);
  const controls = doc.controls ?? {};

  const page = await browser.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 200)}`);
  });

  try {
    await page.goto(`${BASE}/examples/gallery/viewer.html`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.evaluate((s) => {
      const el = document.getElementById("map");
      el.addEventListener("ml-map:error", (e) => {
        (window.__mlErrors ??= []).push(String(e.detail?.error?.message ?? e.detail?.error));
      });
      el.setAttribute("src", `/docs/public/configs/gallery/${s}.yaml`);
    }, slug);

    // Style + all document layers present.
    await page.waitForFunction(
      (ids) => {
        const map = document.getElementById("map")?.getMap?.();
        if (!map || !map.isStyleLoaded?.()) return false;
        return ids.every((id) => Boolean(map.getLayer?.(id)));
      },
      layerIds,
      { timeout: 45000 }
    );

    // Feature-backed layers actually drew something.
    for (const id of queryable) {
      await page
        .waitForFunction(
          (layerId) => {
            const map = document.getElementById("map")?.getMap?.();
            return (
              (map?.queryRenderedFeatures?.(undefined, { layers: [layerId] }) ?? []).length > 0
            );
          },
          id,
          { timeout: 30000 }
        )
        .catch(() => problems.push(`layer "${id}" rendered no features`));
    }

    // Declared controls exist AND demonstrate themselves.
    const ctl = await page.evaluate(() => ({
      attribText: document.querySelector(".maplibregl-ctrl-attrib")?.textContent?.trim() ?? null,
      geolocate: Boolean(document.querySelector(".maplibregl-ctrl-geolocate")),
      fullscreen: Boolean(document.querySelector(".maplibregl-ctrl-fullscreen")),
      zoomIn: Boolean(document.querySelector(".maplibregl-ctrl-zoom-in")),
      mlErrors: window.__mlErrors ?? [],
    }));
    problems.push(...ctl.mlErrors.map((e) => `ml-map:error: ${e}`));
    if (controls.attribution && !ctl.attribText)
      problems.push("attribution control declared but renders EMPTY (invisible)");
    if (controls.geolocate && !ctl.geolocate) problems.push("geolocate control missing");
    if (controls.fullscreen && !ctl.fullscreen) problems.push("fullscreen control missing");
    if (controls.navigation && !ctl.zoomIn) problems.push("navigation control missing");
  } catch (e) {
    problems.push(`FAILED: ${String(e.message).split("\n")[0]}`);
  }

  await page.close();
  const status = problems.length ? "FAIL" : "ok";
  console.log(`${status.padEnd(4)} ${slug}${problems.length ? "\n     - " + problems.join("\n     - ") : ""}`);
  if (problems.length) failures.push(slug);
}

await browser.close();
console.log(`\n${slugs.length - failures.length}/${slugs.length} pages verified` +
  (failures.length ? `; FAILURES: ${failures.join(", ")}` : ""));
process.exit(failures.length ? 1 : 0);
