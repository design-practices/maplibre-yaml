/**
 * On-demand format readers (ml-7qa.5, 0.9) — browser verification, which is
 * also the demo.
 *
 * @remarks
 * The CDN build ships the PMTiles and FlatGeobuf readers as separate files,
 * `dist/chunks/pmtiles.js` and `dist/chunks/flatgeobuf.js`, which the bundle
 * imports relative to its own URL only when a document uses the format.
 * Asserted here:
 *
 *  - a plain map downloads no reader at all;
 *  - a self-hosted copy of `dist/` under a GitHub-Pages-like subpath
 *    (`/my-site/js/maplibre-yaml/`, a real copy on disk) draws PMTiles and
 *    FlatGeobuf, its readers fetched from `…/maplibre-yaml/chunks/`;
 *  - a copy of only the bundle (no `chunks/`: the readers 404) shows a plain
 *    notice naming the file and saying to copy the whole `dist/` folder or
 *    use the CDN, while the rest of the map renders, with no unhandled
 *    rejection;
 *  - a reader blocked by the browser (offline, a content blocker, CSP) fails
 *    the same way, for that format's sources only.
 *
 * The synchronous `pmtiles://` registration that lets a basemap style's first
 * requests wait for the lazily loaded reader is covered by the basemap tests
 * in cloud-native.spec.ts. Requires `pnpm build` (core's dist/).
 */
import { test, expect, type Page } from "@playwright/test";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIST = join(process.cwd(), "packages/core/dist");

/** Page errors (an unhandled rejection is one) and off-origin requests. */
async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || /^(data|blob):/.test(url)) return route.fallback();
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return errors;
}

/** Paths of every script the page requested. */
function scriptsOf(page: Page): string[] {
  const scripts: string[] = [];
  page.on("request", (r) => {
    if (/\.m?js(\?|$)/.test(r.url())) scripts.push(new URL(r.url()).pathname);
  });
  return scripts;
}

/** Wait until a map element's source has rendered features. */
async function waitForFeatures(page: Page, mapId: string, source: string, sourceLayer?: string) {
  await page.waitForFunction(
    ({ mapId, source, sourceLayer }) => {
      const map = (document.getElementById(mapId) as any)?.getMap?.();
      if (!map || !map.getSource(source)) return false;
      return map.querySourceFeatures(source, sourceLayer ? { sourceLayer } : undefined).length > 0;
    },
    { mapId, source, sourceLayer },
    { timeout: 45_000 }
  );
}

/** Wait until a layer has rendered features (for a layer with an inline source). */
async function waitForLayer(page: Page, mapId: string, layer: string) {
  await page.waitForFunction(
    ({ mapId, layer }) => {
      const map = (document.getElementById(mapId) as any)?.getMap?.();
      return Boolean(map?.getLayer(layer)) && map.queryRenderedFeatures(undefined, { layers: [layer] }).length > 0;
    },
    { mapId, layer },
    { timeout: 45_000 }
  );
}

/** A page that loads maplibre-yaml from `script` (only maplibre-gl in its import map). */
function pageHtml(script: string, yaml: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />
  <title>Self-hosted maplibre-yaml</title>
  <link rel="stylesheet" href="/vendor/maplibre-gl.css" />
  <style>body{margin:0} ml-map{display:block;height:420px}</style>
  <script type="importmap">{ "imports": { "maplibre-gl": "/vendor/maplibre-gl.esm.js" } }</script>
  </head><body>
  <ml-map id="map"><script type="text/yaml">${yaml}</script></ml-map>
  <script type="module" src="${script}"></script>
  </body></html>`;
}

/** PMTiles + FlatGeobuf + an inline GeoJSON layer that needs no reader. */
const CLOUD_DOC = `
type: map
id: self-hosted-cloud
config:
  center: [10.2, 42.15]
  zoom: 9.6
  mapStyle: "/examples/verification/configs/local-style.json"
sources:
  outlines:
    type: vector
    url: /gallery-assets/cloud-native/districts.pmtiles
  districts:
    type: geojson
    url: /gallery-assets/cloud-native/districts.fgb
layers:
  - id: districts
    type: fill
    source: districts
    paint: { fill-color: "#e9c46a", fill-opacity: 0.6 }
  - { id: outlines, type: line, source: outlines, source-layer: districts, paint: { line-color: "#1d3557" } }
  - id: marker
    type: circle
    source:
      type: geojson
      data:
        type: FeatureCollection
        features:
          - { type: Feature, properties: {}, geometry: { type: Point, coordinates: [10.2, 42.15] } }
    paint: { circle-radius: 8, circle-color: "#d62828" }
`;

/**
 * Serve `/my-site/<page>` and `/my-site/js/…` from `dir` (a copy on disk), as
 * a static host would — a missing file is a 404.
 */
async function serveSite(page: Page, dir: string, html: string) {
  await page.route(/\/my-site\//, (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/my-site\//, "");
    if (path === "index.html") return route.fulfill({ contentType: "text/html", body: html });
    const file = join(dir, path);
    if (!file.startsWith(dir) || !existsSync(file)) return route.fulfill({ status: 404, body: "not found" });
    return route.fulfill({ path: file });
  });
}

let site: string;
test.beforeAll(() => {
  site = mkdtempSync(join(tmpdir(), "mlym-self-hosted-"));
  // A full copy of dist/ (what the docs say to do)…
  cpSync(DIST, join(site, "js/maplibre-yaml"), {
    recursive: true,
    filter: (src) => !/\.(map|d\.ts)$/.test(src),
  });
  // …and someone who copied only the bundle, renamed.
  cpSync(join(DIST, "register.browser.js"), join(site, "js/maplibre-yaml.js"));
});
test.afterAll(() => {
  if (site) rmSync(site, { recursive: true, force: true });
});

test.describe("format readers load on demand (ml-7qa.5)", () => {
  test("a plain map downloads no reader", async ({ page }) => {
    const errors = await guard(page);
    const scripts = scriptsOf(page);
    await serveSite(
      page,
      site,
      pageHtml(
        "/my-site/js/maplibre-yaml/register.browser.js",
        `
type: map
id: plain
config:
  center: [10.2, 42.15]
  zoom: 9
  mapStyle: "/examples/verification/configs/local-style.json"
layers:
  - id: marker
    type: circle
    source:
      type: geojson
      data: { type: FeatureCollection, features: [ { type: Feature, properties: {}, geometry: { type: Point, coordinates: [10.2, 42.15] } } ] }
    paint: { circle-radius: 8, circle-color: "#d62828" }
`
      )
    );
    await page.goto("/my-site/index.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => (document.getElementById("map") as any).mapReady());
    await waitForLayer(page, "map", "marker");
    expect(scripts.filter((s) => s.includes("/my-site/"))).toEqual(["/my-site/js/maplibre-yaml/register.browser.js"]);
    expect(errors).toEqual([]);
  });

  test("a copy of dist/ under a subpath draws PMTiles and FlatGeobuf, readers from chunks/", async ({ page }) => {
    const errors = await guard(page);
    const scripts = scriptsOf(page);
    await serveSite(page, site, pageHtml("/my-site/js/maplibre-yaml/register.browser.js", CLOUD_DOC));
    await page.goto("/my-site/index.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => (document.getElementById("map") as any).mapReady());
    await waitForFeatures(page, "map", "districts");
    await waitForFeatures(page, "map", "outlines", "districts");
    await waitForLayer(page, "map", "marker");
    await expect(page.locator("#map .ml-map-notice")).toHaveCount(0);
    expect([...new Set(scripts.filter((s) => s.includes("/my-site/")))].sort()).toEqual([
      "/my-site/js/maplibre-yaml/chunks/flatgeobuf.js",
      "/my-site/js/maplibre-yaml/chunks/pmtiles.js",
      "/my-site/js/maplibre-yaml/register.browser.js",
    ]);
    await page.screenshot({ path: "e2e/results/lazy_self_hosted.png" });
    expect(errors).toEqual([]);
  });

  test("only the bundle copied (no chunks/): a plain notice per format, the rest renders", async ({ page }) => {
    const errors = await guard(page);
    await serveSite(page, site, pageHtml("/my-site/js/maplibre-yaml.js", CLOUD_DOC));
    await page.goto("/my-site/index.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => (document.getElementById("map") as any).mapReady());
    // Everything that needs no reader still draws.
    await waitForLayer(page, "map", "marker");
    const notice = page.locator("#map .ml-map-notice");
    await expect(notice).toContainText(/The PMTiles reader \(http:\/\/localhost:\d+\/my-site\/js\/chunks\/pmtiles\.js\) couldn't be downloaded/, {
      timeout: 30_000,
    });
    await expect(notice).toContainText(/The FlatGeobuf reader \((http:\/\/localhost:\d+\/my-site\/js\/)?chunks\/flatgeobuf\.js\) couldn't be downloaded/);
    await expect(notice).toContainText("copy the whole dist/ folder (not just register.js), or load it from the CDN");
    await expect(notice).toContainText("outlines");
    await expect(notice).toContainText("districts");
    await page.screenshot({ path: "e2e/results/lazy_missing_chunks.png" });
    // No unhandled rejection, no uncaught error.
    expect(errors).toEqual([]);
  });

  test("a reader blocked by the browser (offline, a blocker, CSP) fails only its format's sources", async ({ page }) => {
    const errors = await guard(page);
    await page.route("**/chunks/flatgeobuf.js", (route) => route.abort("blockedbyclient"));
    await page.goto("/examples/verification/cloud-native/cdn.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => (document.getElementById("map") as any).mapReady());
    // PMTiles (its reader loaded) still draws…
    await waitForFeatures(page, "map", "outlines", "districts");
    // …and the FlatGeobuf layer says why it has no data.
    const notice = page.locator("#map .ml-map-notice");
    await expect(notice).toContainText(/Layer districts has no data: The FlatGeobuf reader \(.*chunks\/flatgeobuf\.js\) couldn't be downloaded/, {
      timeout: 30_000,
    });
    await expect(notice).not.toContainText("PMTiles reader");
    expect(errors).toEqual([]);
  });
});
