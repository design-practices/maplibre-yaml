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
 *   node scripts/verify-docs-gallery.mjs [slug ...]   # no slugs = every page
 *
 * It also drives the built classics launch page (/examples/classics/, U11) over live
 * tiles: both panes of each classic render, and the live pane's effect is
 * on. That needs the docs build (`pnpm build`).
 *
 * Exits non-zero listing every page that fails its expectations:
 *  - no page/console errors, no ml-map:error events
 *  - every document layer present in the style
 *  - layers with feature-backed sources put real features on screen (qRF)
 *  - declared controls exist in the DOM — and the attribution control has
 *    visible text (an empty attribution control collapses: the exact bug
 *    this sweep was built after)
 *
 * Escape-hatch pages (U16) are driven through the hatch harness in live
 * mode — examples/gallery/hatch/twin.html?slug=<slug>&live — which injects
 * the page's slot chrome and runs the page's own JS against the real docs
 * config, so layers the JS shows or feeds are checked as a reader sees them.
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

// Pages whose layers draw, but where queryRenderedFeatures can't see them.
// Each names the test that asserts something else instead.
const QRF_BLIND = new Map([
  [
    "set-center-point-above-ground",
    "qRF finds nothing under a steep pitch around a raised centre; e2e/gallery.spec.ts asserts querySourceFeatures",
  ],
]);

// The hatch harness's own manifest: every slug it knows runs with its JS.
const HATCH_SLUGS = new Set(
  [...readFileSync("examples/gallery/hatch/twin.js", "utf8").matchAll(/^\s+"([a-z0-9-]+)": \{/gm)].map(
    (m) => m[1]
  )
);

// Optional slug arguments narrow the run: node scripts/verify-docs-gallery.mjs a b
const only = new Set(process.argv.slice(2));
const slugs = readdirSync(CONFIG_DIR)
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => f.replace(/\.yaml$/, ""))
  .filter((slug) => only.size === 0 || only.has(slug))
  .sort();

const browser = await chromium.launch();
const failures = [];

// A skip entry must point at a real replacement test — a dangling pointer
// would quietly reduce "explicitly covered elsewhere" to "covered nowhere".
const hatchSpec =
  readFileSync("e2e/gallery-hatch.spec.ts", "utf8") +
  readFileSync("e2e/gallery-hatch-u16.spec.ts", "utf8") +
  readFileSync("e2e/gallery.spec.ts", "utf8");
for (const [slug] of PROTOCOL_PAGES) {
  if (!hatchSpec.includes(slug)) {
    console.error(`PROTOCOL_PAGES names "${slug}" but no gallery spec has a test mentioning it`);
    process.exit(1);
  }
}
for (const [slug] of QRF_BLIND) {
  if (!hatchSpec.includes(slug)) {
    console.error(`QRF_BLIND names "${slug}" but no gallery spec has a test mentioning it`);
    process.exit(1);
  }
}

let skipped = 0;
for (const slug of slugs) {
  if (PROTOCOL_PAGES.has(slug)) {
    console.log(`SKIP ${slug} — ${PROTOCOL_PAGES.get(slug)}`);
    skipped += 1;
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
    .filter(() => !QRF_BLIND.has(slug))
    .map((l) => l.id);
  const controls = doc.controls ?? {};

  const page = await browser.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 200)}`);
  });

  try {
    if (HATCH_SLUGS.has(slug)) {
      // Capture-phase listener: catches the element's error event however
      // the harness wires the element up.
      await page.addInitScript(() => {
        document.addEventListener(
          "ml-map:error",
          (e) => (window.__mlErrors ??= []).push(String(e.detail?.error?.message ?? e.detail?.error)),
          true
        );
      });
      await page.goto(`${BASE}/examples/gallery/hatch/twin.html?slug=${slug}&live`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
    } else {
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
    }

    // Style + all document layers present. A hatch page's JS may keep a
    // source permanently busy (a setData every frame), so isStyleLoaded()
    // can stay false there; layers being present is the signal instead.
    await page.waitForFunction(
      ({ ids, hatch }) => {
        const map = document.getElementById("map")?.getMap?.();
        if (!map || (!hatch && !map.isStyleLoaded?.())) return false;
        return ids.every((id) => Boolean(map.getLayer?.(id)));
      },
      { ids: layerIds, hatch: HATCH_SLUGS.has(slug) },
      { timeout: 45000 }
    );

    // Feature-backed layers actually drew something.
    for (const id of queryable) {
      await page
        .waitForFunction(
          (layerId) => {
            const map = document.getElementById("map")?.getMap?.();
            if (!map?.queryRenderedFeatures) return false;
            if (map.queryRenderedFeatures(undefined, { layers: [layerId] }).length > 0) return true;
            // Under globe projection a whole-viewport query returns nothing
            // (seen in U15; the hermetic twins check at a point for the same
            // reason), so probe a grid of points across the canvas instead.
            if (map.getProjection?.()?.type !== "globe") return false;
            const { width, height } = map.getCanvas().getBoundingClientRect();
            for (let gx = 1; gx < 8; gx++) {
              for (let gy = 1; gy < 8; gy++) {
                const point = [(width * gx) / 8, (height * gy) / 8];
                if (map.queryRenderedFeatures(point, { layers: [layerId] }).length > 0) return true;
              }
            }
            return false;
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
      globe: Boolean(document.querySelector(".maplibregl-ctrl-globe, .maplibregl-ctrl-globe-enabled")),
      terrain: Boolean(document.querySelector(".maplibregl-ctrl-terrain, .maplibregl-ctrl-terrain-enabled")),
      // U15: the 3D trio reached the live map, not just the style.
      terrainSource: document.getElementById("map")?.getMap?.()?.getTerrain?.()?.source ?? null,
      projection: document.getElementById("map")?.getMap?.()?.getProjection?.()?.type ?? null,
      mlErrors: window.__mlErrors ?? [],
    }));
    problems.push(...ctl.mlErrors.map((e) => `ml-map:error: ${e}`));
    if (controls.attribution && !ctl.attribText)
      problems.push("attribution control declared but renders EMPTY (invisible)");
    if (controls.geolocate && !ctl.geolocate) problems.push("geolocate control missing");
    if (controls.fullscreen && !ctl.fullscreen) problems.push("fullscreen control missing");
    if (controls.navigation && !ctl.zoomIn) problems.push("navigation control missing");
    if (controls.globe && !ctl.globe) problems.push("globe control missing");
    if (controls.terrain && !ctl.terrain) problems.push("terrain control missing");
    if (doc.terrain && ctl.terrainSource !== doc.terrain.source)
      problems.push(`terrain not applied (getTerrain().source = ${ctl.terrainSource})`);
    if (doc.projection && ctl.projection !== doc.projection.type)
      problems.push(`projection not applied (getProjection().type = ${ctl.projection})`);
  } catch (e) {
    problems.push(`FAILED: ${String(e.message).split("\n")[0]}`);
  }

  await page.close();
  const status = problems.length ? "FAIL" : "ok";
  console.log(`${status.padEnd(4)} ${slug}${problems.length ? "\n     - " + problems.join("\n     - ") : ""}`);
  if (problems.length) failures.push(slug);
}

// ---------------------------------------------------------------------------
// The classics launch page (U11): the BUILT page (docs/dist, which the
// verification server mounts at /classics/) against live OpenFreeMap tiles
// and glyphs. Its documents name their textures, sprites and glyphs on
// docs.maplibre-yaml.org; those are answered from this tree's build (the
// files the next deploy ships) unless VERIFY_CLASSICS_SITE=live, which
// checks the deployed copies instead. The hermetic twin is
// e2e/classics.spec.ts. Build the docs first (pnpm build).
const CLASSICS = ["crosshatch", "blueprint"];
const SITE = "https://docs.maplibre-yaml.org";
let classicsChecked = 0;
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 200)}`);
  });
  if (process.env.VERIFY_CLASSICS_SITE !== "live") {
    await page.route(`${SITE}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      try {
        const body = readFileSync(`docs/dist${decodeURIComponent(path)}`);
        await route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, body });
      } catch {
        problems.push(`not in the docs build: ${path}`);
        await route.fulfill({ status: 404, body: "not found" });
      }
    });
  }
  try {
    await page.goto(`${BASE}/examples/classics/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction(
      (n) => document.querySelectorAll('section.classic[data-ready="true"]').length === n,
      CLASSICS.length,
      { timeout: 45000 }
    );
    for (const name of CLASSICS) {
      classicsChecked += 1;
      const panes = page
        .waitForFunction(
          (n) => {
            const { live, ejected } = document.querySelector(`section.classic[data-classic="${n}"]`).__maps;
            const qrf = (m, id) => m.queryRenderedFeatures(undefined, { layers: [id] }).length;
            return qrf(live, "roads") > 0 && qrf(ejected, "roads") > 0 && qrf(ejected, "buildings") > 0;
          },
          name,
          { timeout: 45000 }
        )
        .catch(() => problems.push(`${name}: a pane rendered no roads/buildings from live tiles`));
      const effect = page
        .waitForFunction(
          (n) => document.querySelector(`section.classic[data-classic="${n}"] [data-fx-status]`)?.dataset.state === "on",
          name,
          { timeout: 45000 }
        )
        .catch(async () => {
          const text = await page
            .locator(`section.classic[data-classic="${name}"] [data-fx-status]`)
            .textContent();
          problems.push(`${name}: live pane effect not on (${text})`);
        });
      await Promise.all([panes, effect]);
    }
  } catch (e) {
    problems.push(`FAILED: ${String(e.message).split("\n")[0]}`);
  }
  await page.close();
  console.log(
    `${problems.length ? "FAIL" : "ok  "} classics launch page (${CLASSICS.join(", ")})` +
      (problems.length ? "\n     - " + problems.join("\n     - ") : "")
  );
  if (problems.length) failures.push("classics");
}

await browser.close();
console.log(
  `\n${slugs.length - failures.filter((f) => f !== "classics").length - skipped}/${slugs.length - skipped} pages verified` +
    `; classics launch page: ${failures.includes("classics") ? "FAIL" : "ok"} (${classicsChecked} classics)` +
    (skipped ? ` (${skipped} skipped — see SKIP lines above)` : "") +
    (failures.length ? `; FAILURES: ${failures.join(", ")}` : "")
);
process.exit(failures.length ? 1 : 0);
