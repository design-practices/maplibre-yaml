/**
 * Getting-started docs snippets — browser verification, run VERBATIM.
 *
 * @remarks
 * A new vanilla-JS user copies the quick-start HTML and YAML exactly as the
 * docs print them. This spec reads those fences straight out of the `.mdx`
 * sources at test time and serves them unmodified, so the page under test is
 * byte-for-byte what the reader copies — when the docs change, the test
 * changes with them, and a snippet that stops rendering fails here.
 *
 * Covered:
 *  - quick-start.mdx step 1 HTML + step 2 YAML (`<ml-map src>` via the CDN
 *    import-map pattern), and the "Add interactivity" YAML (click → popup);
 *  - vanilla-js.mdx "JavaScript API" quick start (esm.sh `?external=maplibre-gl`
 *    + `MapRenderer.fromModel(toModel(...))`).
 *
 * Hermetic like the rest of the suite: every external URL a snippet names must
 * appear in the CDN table below, which maps it onto the local build (unpkg core
 * → `packages/core`, unpkg maplibre-gl → the vendored shim, the demotiles
 * style → the local fixture style, the USGS feed → an inline fixture). An
 * unlisted URL fails the test, which is also what pins the snippets' versions:
 * an unpinned or mismatched maplibre-gl URL (the JS on one major, the CSS on
 * another) is not in the table.
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DOCS = join(__dirname, "..", "docs/src/content/docs");

/** Fenced code blocks of one language, in document order, de-indented. */
function fences(file: string, lang: string): string[] {
  const lines = readFileSync(join(DOCS, file), "utf8").split("\n");
  const out: string[] = [];
  let open: { indent: number; fence: string; lang: string; body: string[] } | null = null;
  for (const line of lines) {
    if (!open) {
      const m = line.match(/^(\s*)(`{3,})(\S*)/);
      if (m) open = { indent: m[1].length, fence: m[2], lang: m[3], body: [] };
    } else if (line.trim() === open.fence) {
      if (open.lang === lang) {
        const n = open.indent;
        out.push(open.body.map((l) => (l.slice(0, n).trim() === "" ? l.slice(n) : l)).join("\n") + "\n");
      }
      open = null;
    } else {
      open.body.push(line);
    }
  }
  return out;
}

/** A stand-in for the USGS feed: three California quakes with `title`s. */
const QUAKES = {
  type: "FeatureCollection",
  features: [
    [-120, 37, "M 3.1 - Central California"],
    [-118.4, 34.1, "M 2.4 - Los Angeles"],
    [-121.9, 37.4, "M 1.8 - San Jose"],
  ].map(([lng, lat, title]) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: { title, mag: 2 },
  })),
};

/**
 * maplibre-gl as the import map hands it to the page: the vendored shim, with
 * `Map` subclassed so every map a snippet creates lands on `__docMaps` — the
 * only way to inspect a map that the JavaScript-API snippet keeps in a local.
 */
function trackingMaplibre(baseURL: string): string {
  return `import gl from "${baseURL}/vendor/maplibre-gl.esm.js";
class Map extends gl.Map {
  constructor(options) {
    super(options);
    (globalThis.__docMaps ||= []).push(this);
  }
}
const tracked = Object.create(gl, { Map: { value: Map, enumerable: true } });
export default tracked;
export { Map };
export const Popup = gl.Popup;
export const Marker = gl.Marker;
export const LngLat = gl.LngLat;
export const LngLatBounds = gl.LngLatBounds;
export const NavigationControl = gl.NavigationControl;
export const GeolocateControl = gl.GeolocateControl;
export const ScaleControl = gl.ScaleControl;
export const FullscreenControl = gl.FullscreenControl;
export const AttributionControl = gl.AttributionControl;
`;
}

/**
 * The external URLs the snippets may name, and the local resource each one is
 * served from. Keys are matched exactly (query string included).
 */
function cdnTable(baseURL: string): Record<string, string | { js: string } | object> {
  return {
    "https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.css": `${baseURL}/vendor/maplibre-gl.css`,
    "https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.mjs": { js: trackingMaplibre(baseURL) },
    "https://unpkg.com/@maplibre-yaml/core/register.js": `${baseURL}/packages/core/register.js`,
    "https://unpkg.com/@maplibre-yaml/core/dist/register.browser.js": `${baseURL}/packages/core/dist/register.browser.js`,
    "https://esm.sh/@maplibre-yaml/core?external=maplibre-gl": `${baseURL}/packages/core/dist/index.browser.js`,
    "https://demotiles.maplibre.org/style.json": `${baseURL}/examples/verification/configs/local-style.json`,
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson": QUAKES,
  };
}

/**
 * Serve `files` under `/__docs/<name>/`, map CDN URLs through the table, and
 * fail on anything else off-origin, on page errors, and on console errors.
 */
async function serveSnippet(
  page: Page,
  baseURL: string,
  name: string,
  files: Record<string, string>
): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });

  const table = cdnTable(baseURL);
  const prefix = `${baseURL}/__docs/${name}/`;
  await page.route("**/*", async (route: Route) => {
    // Browsers percent-encode `^` (esm.sh semver ranges); the table is literal.
    const url = decodeURI(route.request().url());
    if (url.startsWith(prefix)) {
      const file = url.slice(prefix.length) || "index.html";
      if (!(file in files)) return route.fulfill({ status: 404, body: "not found" });
      const type = file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "text/javascript" : "text/yaml";
      return route.fulfill({ body: files[file], contentType: `${type}; charset=utf-8` });
    }
    if (url in table) {
      const target = table[url];
      if (typeof target === "object" && "js" in target) {
        return route.fulfill({ body: (target as { js: string }).js, contentType: "text/javascript" });
      }
      if (typeof target !== "string") return route.fulfill({ json: target });
      return route.fulfill({ response: await page.request.fetch(target) });
    }
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || url.startsWith("data:")) {
      return route.continue();
    }
    errors.push(`URL not in the docs CDN table (unpinned, renamed, or new?): ${url}`);
    return route.abort();
  });
  return errors;
}

/** Every external URL a snippet names must be one the table knows. */
function expectKnownUrls(baseURL: string, ...snippets: string[]) {
  const known = Object.keys(cdnTable(baseURL));
  for (const s of snippets) {
    for (const url of s.match(/https?:\/\/[^\s"'`<>)]+/g) ?? []) {
      expect(known, `snippet names an unknown URL: ${url}`).toContain(url);
    }
  }
}

/** Run `wait`; on failure, report the page's errors rather than a bare timeout. */
async function orReport<T>(wait: Promise<T>, errors: string[]): Promise<T> {
  try {
    return await wait;
  } catch (e) {
    throw new Error(`${(e as Error).message}\npage errors:\n${errors.join("\n") || "(none)"}`);
  }
}

/** Wait for an `<ml-map>`'s document to load with `layerId` drawing features. */
function waitForRenderedLayer(page: Page, layerId: string) {
  return page.waitForFunction(
    (id) => {
      const map = (document.querySelector("ml-map") as any)?.getMap?.();
      if (!map || !map.loaded?.() || !map.getLayer?.(id)) return false;
      return map.queryRenderedFeatures({ layers: [id] }).length > 0;
    },
    layerId,
    { timeout: 60_000 }
  );
}

test.describe("docs: getting-started snippets render verbatim", () => {
  test("quick start: index.html + earthquake-map.yaml render the earthquake layer", async ({
    page,
    baseURL,
  }) => {
    const [html] = fences("getting-started/quick-start.mdx", "html");
    const [yaml] = fences("getting-started/quick-start.mdx", "yaml");
    expectKnownUrls(baseURL!, html, yaml);

    const errors = await serveSnippet(page, baseURL!, "quick-start", {
      "index.html": html,
      "earthquake-map.yaml": yaml,
    });
    await page.goto(`/__docs/quick-start/`, { waitUntil: "domcontentloaded" });
    await orReport(waitForRenderedLayer(page, "earthquakes"), errors);

    const view = await page.evaluate(() => {
      const map = (document.querySelector("ml-map") as any).getMap();
      return { center: map.getCenter().toArray(), zoom: map.getZoom() };
    });
    expect(view.center[0]).toBeCloseTo(-120, 3);
    expect(view.center[1]).toBeCloseTo(37, 3);
    expect(view.zoom).toBeCloseTo(5, 3);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("quick start: 'Add interactivity' YAML opens a popup with the feature title", async ({
    page,
    baseURL,
  }) => {
    const [html] = fences("getting-started/quick-start.mdx", "html");
    const yaml = fences("getting-started/quick-start.mdx", "yaml").find((y) =>
      y.includes("interactive:")
    )!;
    expect(yaml, "the interactivity snippet").toBeTruthy();
    expectKnownUrls(baseURL!, html, yaml);

    const errors = await serveSnippet(page, baseURL!, "quick-start-interactive", {
      "index.html": html,
      "earthquake-map.yaml": yaml,
    });
    await page.goto(`/__docs/quick-start-interactive/`, { waitUntil: "domcontentloaded" });
    await orReport(waitForRenderedLayer(page, "earthquakes"), errors);

    // Click the quake at the map centre (-120, 37), as the interactions suite
    // does: fire the delegated map event so it lands on the feature.
    await page.evaluate(() => {
      const map = (document.querySelector("ml-map") as any).getMap();
      const at = { lng: -120, lat: 37 };
      map.fire("click", { lngLat: at, point: map.project(at) });
    });
    const popup = page.locator(".maplibregl-popup-content");
    await expect(popup).toBeVisible();
    await expect(popup.locator("h3")).toHaveText("M 3.1 - Central California");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("vanilla JS: the JavaScript API quick start renders via MapRenderer.fromModel", async ({
    page,
    baseURL,
  }) => {
    const html = fences("integrations/vanilla-js.mdx", "html")[1];
    const [yaml] = fences("integrations/vanilla-js.mdx", "yaml");
    const js = fences("integrations/vanilla-js.mdx", "javascript")[0];
    expect(html).toContain('src="map.js"');
    expect(js).toContain("MapRenderer");
    expectKnownUrls(baseURL!, html, yaml, js);

    const errors = await serveSnippet(page, baseURL!, "vanilla-api", {
      "index.html": html,
      "map.yaml": yaml,
      "map.js": js,
    });
    const loaded = page.waitForEvent("console", {
      predicate: (m) => m.text() === "Map loaded successfully!",
      timeout: 60_000,
    });
    await page.goto(`/__docs/vanilla-api/`, { waitUntil: "domcontentloaded" });
    await orReport(loaded, errors);

    // The renderer drew the document into #map: the view from the YAML, and the
    // `points` layer hit-testable at the centre.
    await expect(page.locator("#map canvas.maplibregl-canvas")).toBeVisible();
    await page.waitForFunction(
      () => {
        const map = (globalThis as any).__docMaps?.[0];
        if (!map || !map.loaded() || !map.getLayer("points")) return false;
        return map.queryRenderedFeatures({ layers: ["points"] }).length > 0;
      },
      undefined,
      { timeout: 60_000 }
    );
    const zoom = await page.evaluate(() => (globalThis as any).__docMaps[0].getZoom());
    expect(zoom).toBeCloseTo(12, 3);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
