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
 * in cloud-native.spec.ts.
 *
 * The live-documents update engine (ml-4ug, 0.10) rides the same seam as
 * `dist/chunks/update.js`, so the second describe asserts the same contract
 * for it: a plain page never requests it; the first `el.config = …` change
 * downloads it exactly once and a second change downloads nothing; a first
 * update whose chunk fetch fails is refused (`ml-map:update-rejected`, kind
 * `chunk`) with the map untouched and no error card, and `reload()` asks for
 * the file again under a `?retry=` URL. Requires `pnpm build` (core's dist/).
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
    // Every request for the file, retries (`?retry=1`) included.
    await page.route("**/chunks/flatgeobuf.js*", (route) => route.abort("blockedbyclient"));
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

  test("a reader that failed once downloads again on reload(): the browser's failed import isn't reused", async ({
    page,
  }) => {
    const errors = await guard(page);
    const asked: string[] = [];
    let offline = true;
    await page.route("**/chunks/flatgeobuf.js*", (route) => {
      asked.push(new URL(route.request().url()).search || "(no query)");
      return offline ? route.abort("internetdisconnected") : route.fallback();
    });
    await page.goto("/examples/verification/cloud-native/cdn.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => (document.getElementById("map") as any).mapReady());
    const notice = page.locator("#map .ml-map-notice");
    await expect(notice).toContainText("The FlatGeobuf reader", { timeout: 30_000 });
    const failedAsks = asked.length;
    expect(failedAsks).toBeGreaterThan(0);
    // Back online: reload() asks for the file again — under a URL of its
    // own, since the browser would repeat the failed import without a
    // request — and the layer draws.
    offline = false;
    await page.evaluate(() => (document.getElementById("map") as any).reload());
    await page.evaluate(() => (document.getElementById("map") as any).mapReady());
    await waitForFeatures(page, "map", "districts");
    expect(asked.length).toBe(failedAsks + 1);
    expect(asked.at(-1)).toBe(`?retry=${failedAsks}`);
    await expect(page.locator("#map .ml-map-notice")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

/** What the element answered a document with: the next `ml-map:update-*` event, as the page saw it. */
interface UpdateOutcome {
  type: "ml-map:update-applied" | "ml-map:update-rejected";
  detail: { kind?: string; errors?: { kind: string; message: string }[]; summary?: Record<string, unknown> };
}

/**
 * Hand the running map a document — a paint-only edit of one layer's
 * `circle-color` (`{ recolour }`), or a `reload()` — and resolve with the
 * real DOM event the element dispatched for it, listened for before the
 * assignment so nothing is missed.
 */
function outcomeOf(page: Page, action: { recolour: string } | "reload"): Promise<UpdateOutcome> {
  return page.evaluate(
    (action) =>
      new Promise<UpdateOutcome>((resolve) => {
        const el = document.getElementById("map") as any;
        const done = (event: Event) => {
          el.removeEventListener("ml-map:update-applied", done);
          el.removeEventListener("ml-map:update-rejected", done);
          resolve({ type: event.type as UpdateOutcome["type"], detail: (event as CustomEvent).detail });
        };
        el.addEventListener("ml-map:update-applied", done);
        el.addEventListener("ml-map:update-rejected", done);
        if (action === "reload") {
          el.reload();
          return;
        }
        const next = JSON.parse(JSON.stringify(el.getDocument()));
        next.layers.find((layer: { id: string }) => layer.id === "dot").paint["circle-color"] = action.recolour;
        el.config = next;
      }),
    action
  );
}

/** The dots' colour as the live map paints it, and as the element's document says. */
function dotColour(page: Page): Promise<{ painted: unknown; document: unknown }> {
  return page.evaluate(() => {
    const el = document.getElementById("map") as any;
    return {
      painted: el.getMap().getPaintProperty("dot", "circle-color"),
      document: el.getDocument().layers.find((layer: { id: string }) => layer.id === "dot").paint["circle-color"],
    };
  });
}

const UPDATE_CHUNK = "/cdn/@maplibre-yaml/core@0.10.0/dist/chunks/update.js";

test.describe("the update engine loads on the first update only (ml-4ug, live documents)", () => {
  test("a plain page never requests chunks/update.js; the first config change does, once; a second change does not", async ({
    page,
  }) => {
    const errors = await guard(page);
    const scripts = scriptsOf(page);
    const chunkRequests = () => scripts.filter((s) => s.includes("/chunks/"));
    await page.goto("/examples/verification/update-chunk.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => (document.getElementById("map") as any).mapReady());
    await waitForLayer(page, "map", "dot");
    // The page as served: the bundle and nothing from chunks/.
    expect([...new Set(scripts.filter((s) => s.includes("/cdn/")))].sort()).toEqual([
      "/cdn/@maplibre-yaml/core@0.10.0/dist/register.browser.js",
      "/cdn/@maplibre-yaml/core@0.10.0/register.js",
    ]);
    expect(chunkRequests()).toEqual([]);

    // First change: the engine is downloaded, once, and the edit lands.
    const first = await outcomeOf(page, { recolour: "#e9c46a" });
    expect(first.type).toBe("ml-map:update-applied");
    expect(first.detail.summary?.propertiesSet).toEqual([{ layerId: "dot", property: "circle-color" }]);
    expect(chunkRequests()).toEqual([UPDATE_CHUNK]);
    expect(await dotColour(page)).toEqual({ painted: "#e9c46a", document: "#e9c46a" });

    // Second change: nothing more is requested.
    const second = await outcomeOf(page, { recolour: "#2a9d8f" });
    expect(second.type).toBe("ml-map:update-applied");
    expect(chunkRequests()).toEqual([UPDATE_CHUNK]);
    expect(await dotColour(page)).toEqual({ painted: "#2a9d8f", document: "#2a9d8f" });

    // The page's own log saw the same two events, in order, and no error.
    const logged = await page.evaluate(() => (window as any).__events.map((e: { type: string }) => e.type));
    expect(logged.filter((t: string) => t !== "ml-map:state-change")).toEqual([
      "ml-map:load",
      "ml-map:update-applied",
      "ml-map:update-applied",
    ]);
    await expect(page.locator("#map .ml-map-error")).toHaveCount(0);
    await page.screenshot({ path: "e2e/results/lazy_update_chunk.png" });
    expect(errors).toEqual([]);
  });

  test("a first update whose chunk fetch fails is refused (kind chunk), the map stays, and reload() fetches the chunk again", async ({
    page,
  }) => {
    const errors = await guard(page);
    const asked: string[] = [];
    let offline = true;
    await page.route("**/chunks/update.js*", (route) => {
      asked.push(new URL(route.request().url()).search || "(no query)");
      return offline ? route.abort("internetdisconnected") : route.fallback();
    });
    await page.goto("/examples/verification/update-chunk.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => (document.getElementById("map") as any).mapReady());
    await waitForLayer(page, "map", "dot");
    expect(asked).toEqual([]);

    // The change is refused: the event says why, the map and its document are untouched, no error card.
    const refused = await outcomeOf(page, { recolour: "#e9c46a" });
    expect(refused.type).toBe("ml-map:update-rejected");
    expect(refused.detail.kind).toBe("chunk");
    expect(refused.detail.errors?.[0]?.kind).toBe("chunk");
    expect(refused.detail.errors?.[0]?.message).toMatch(/chunks\/update\.js/);
    expect(asked).toEqual(["(no query)"]);
    expect(await dotColour(page)).toEqual({ painted: "#d62828", document: "#d62828" });
    await expect(page.locator("#map .ml-map-error")).toHaveCount(0);
    expect(await page.evaluate(() => Boolean((document.getElementById("map") as any).getMap()?.getLayer("route")))).toBe(true);

    // Back online: reload() asks for the file again — under a URL of its own,
    // since the browser would repeat the failed import without a request.
    offline = false;
    const reloaded = await outcomeOf(page, "reload");
    expect(reloaded.type).toBe("ml-map:update-applied");
    expect(asked).toEqual(["(no query)", "?retry=1"]);

    // The engine is now loaded: the same edit applies, with no further request.
    const applied = await outcomeOf(page, { recolour: "#e9c46a" });
    expect(applied.type).toBe("ml-map:update-applied");
    expect(asked).toEqual(["(no query)", "?retry=1"]);
    expect(await dotColour(page)).toEqual({ painted: "#e9c46a", document: "#e9c46a" });
    await expect(page.locator("#map .ml-map-error")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
