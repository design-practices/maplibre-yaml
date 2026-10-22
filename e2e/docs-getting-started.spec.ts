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
 *    import-map pattern), and the "Add interactivity" YAML (click → popup),
 *    also on a phone-sized viewport (the viewport meta tag);
 *  - installation.mdx's CDN page and the map.yaml next to it;
 *  - first-map.mdx "Putting it together" YAML (formatted popup) and its
 *    "Using your own data file" change, on the quick start's page, which
 *    first-map continues;
 *  - vanilla-js.mdx "JavaScript API" quick start (esm.sh `?external=maplibre-gl`
 *    + `MapRenderer.fromModel(toModel(...))`);
 *  - web-components.mdx Quick Start steps and the Slots example;
 *  - the READMEs' plain-HTML quick starts (packages/core/README.md, which npm
 *    shows, and the repo root README.md, which GitHub shows);
 *  - the page `mlym init --template basic` scaffolds (the CLI's own output,
 *    which the getting-started path hands to students).
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
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(__dirname, "..");
const DOCS = join(REPO, "docs/src/content/docs");

/** Fenced code blocks of one language in a docs page, in document order, de-indented. */
function fences(file: string, lang: string): string[] {
  return fencesIn(join(DOCS, file), lang);
}

/** The same, for a README (path relative to the repo root): what npm and GitHub show. */
function readmeFences(file: string, lang: string): string[] {
  return fencesIn(join(REPO, file), lang);
}

function fencesIn(path: string, lang: string): string[] {
  const lines = readFileSync(path, "utf8").split("\n");
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

/** A stand-in for the USGS feed: three California quakes, with the feed's `title`, `place` and `mag`. */
const QUAKES = {
  type: "FeatureCollection",
  features: (
    [
      [-120, 37, 3.1, "Central California"],
      [-118.4, 34.1, 2.4, "Los Angeles"],
      [-121.9, 37.4, 1.8, "San Jose"],
    ] as const
  ).map(([lng, lat, mag, place]) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: { title: `M ${mag} - ${place}`, place, mag },
  })),
};

/** A stand-in for the Natural Earth rivers file the root README maps. */
const RIVERS = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[-95, 36], [-90, 38], [-85, 40]] },
      properties: { name: "Mississippi (fixture)" },
    },
  ],
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
    // Core is pinned to the 0.8 line (the release that ships <ml-scrollytelling>
    // and `base`) in every beginner snippet, the npm READMEs and the CLI's
    // templates; an unpinned or stale (`@0.7`) core URL is not here.
    "https://unpkg.com/@maplibre-yaml/core@0.9/register.js": `${baseURL}/packages/core/register.js`,
    "https://unpkg.com/@maplibre-yaml/core@0.9/dist/register.browser.js": `${baseURL}/packages/core/dist/register.browser.js`,
    "https://esm.sh/@maplibre-yaml/core@0.9?external=maplibre-gl": `${baseURL}/packages/core/dist/index.browser.js`,
    // The beginner basemap (streets + labels, no key) and the world-map one.
    "https://tiles.openfreemap.org/styles/liberty": `${baseURL}/examples/verification/configs/local-style.json`,
    "https://demotiles.maplibre.org/style.json": `${baseURL}/examples/verification/configs/local-style.json`,
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson": QUAKES,
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_rivers_lake_centerlines.geojson": RIVERS,
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
      const type = file.endsWith(".html")
        ? "text/html"
        : file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".geojson") || file.endsWith(".json")
            ? "application/geo+json"
            : "text/yaml";
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

/** first-map.mdx "Putting it together": the whole map document. */
function firstMapWhole(): string {
  const yaml = fences("getting-started/first-map.mdx", "yaml").find(
    (y) => /^type: map$/m.test(y) && y.includes("interpolate") && y.includes("controls:")
  );
  expect(yaml, "first-map.mdx 'Putting it together' document").toBeDefined();
  return yaml!;
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
  test("quick start: index.html + map.yaml render the earthquake layer", async ({
    page,
    baseURL,
  }) => {
    const [html] = fences("getting-started/quick-start.mdx", "html");
    const [yaml] = fences("getting-started/quick-start.mdx", "yaml");
    expectKnownUrls(baseURL!, html, yaml);

    const errors = await serveSnippet(page, baseURL!, "quick-start", {
      "index.html": html,
      "map.yaml": yaml,
    });
    await page.goto(`/__docs/quick-start/`, { waitUntil: "domcontentloaded" });
    await orReport(waitForRenderedLayer(page, "earthquakes"), errors);

    const view = await page.evaluate(() => {
      const map = (document.querySelector("ml-map") as any).getMap();
      return { center: map.getCenter().toArray(), zoom: map.getZoom() };
    });
    expect(view.center[0]).toBeCloseTo(-120, 3);
    expect(view.center[1]).toBeCloseTo(37, 3);
    expect(view.zoom).toBeCloseTo(4, 3);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("installation: the CDN page and the map.yaml it loads are both on the page (ml-aot.49)", async ({
    page,
    baseURL,
  }) => {
    const html = fences("getting-started/installation.mdx", "html").find((h) => h.includes('src="./map.yaml"'))!;
    expect(html, "CDN host page").toBeDefined();
    const yaml = fences("getting-started/installation.mdx", "yaml").find((y) => /^type: map$/m.test(y));
    expect(yaml, "installation.mdx shows no map.yaml for the CDN page").toBeDefined();
    expectKnownUrls(baseURL!, html, yaml!);
    const errors = await serveSnippet(page, baseURL!, "install-cdn", { "index.html": html, "map.yaml": yaml! });
    await page.goto(`/__docs/install-cdn/`, { waitUntil: "domcontentloaded" });
    await orReport(waitForRenderedLayer(page, "earthquakes"), errors);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("first map: 'Using your own data file' loads the saved copy of the feed", async ({
    page,
    baseURL,
  }) => {
    // First map continues the quick start's folder: its index.html, unchanged.
    const [html] = fences("getting-started/quick-start.mdx", "html");
    const whole = firstMapWhole();
    const fragment = fences("getting-started/first-map.mdx", "yaml").find((y) =>
      y.includes('url: "data/earthquakes.geojson"')
    )!;
    expect(fragment, "first-map.mdx shows the source pointing at data/earthquakes.geojson").toBeDefined();
    // The page's own recipe: the source's url: line becomes the local file.
    const localUrl = fragment.match(/^\s*url: .*$/m)![0].trim();
    const yaml = whole.replace(/^(\s*)url: "https:\/\/earthquake\.usgs\.gov[^"]*"$/m, `$1${localUrl}`);
    expect(yaml).toContain('url: "data/earthquakes.geojson"');
    const errors = await serveSnippet(page, baseURL!, "first-map-data", {
      "index.html": html,
      "map.yaml": yaml,
      "data/earthquakes.geojson": JSON.stringify(QUAKES),
    });
    await page.goto(`/__docs/first-map-data/`, { waitUntil: "domcontentloaded" });
    await orReport(waitForRenderedLayer(page, "earthquakes"), errors);
    expect(await page.locator(".ml-map-notice").count()).toBe(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("quick start: 'Add a popup' YAML opens a popup with the feature title", async ({
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
      "map.yaml": yaml,
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
    const html = fences("integrations/vanilla-js.mdx", "html").find((h) => h.includes('src="map.js"'))!;
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
      predicate: (m) => m.text() === "map loaded",
      timeout: 60_000,
    });
    await page.goto(`/__docs/vanilla-api/`, { waitUntil: "domcontentloaded" });
    await orReport(loaded, errors);

    // The renderer drew the document into #map: the view from the YAML, and the
    // `quakes` layer drawing the (stubbed) feed.
    await expect(page.locator("#map canvas.maplibregl-canvas")).toBeVisible();
    await page.waitForFunction(
      () => {
        const map = (globalThis as any).__docMaps?.[0];
        if (!map || !map.loaded() || !map.getLayer("quakes")) return false;
        return map.queryRenderedFeatures({ layers: ["quakes"] }).length > 0;
      },
      undefined,
      { timeout: 60_000 }
    );
    const zoom = await page.evaluate(() => (globalThis as any).__docMaps[0].getZoom());
    expect(zoom).toBeCloseTo(4, 3);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("quick start on a phone: the viewport meta tag lays the page out at device width", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const [html] = fences("getting-started/quick-start.mdx", "html");
    const [yaml] = fences("getting-started/quick-start.mdx", "yaml");
    const errors = await serveSnippet(page, baseURL!, "quick-start-mobile", {
      "index.html": html,
      "map.yaml": yaml,
    });
    await page.goto(`/__docs/quick-start-mobile/`, { waitUntil: "domcontentloaded" });
    await orReport(waitForRenderedLayer(page, "earthquakes"), errors);
    // Without <meta name="viewport"> a mobile browser lays the page out at
    // 980px and scales it down, so the map and its controls end up tiny.
    const layout = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      map: (document.querySelector("ml-map") as HTMLElement).getBoundingClientRect().width,
    }));
    expect(layout.width).toBe(390);
    expect(layout.map).toBe(390);
    expect(errors, errors.join("\n")).toEqual([]);
    await context.close();
  });

  test("first map: host page + 'Putting it together' YAML render, popup formats the magnitude", async ({
    page,
    baseURL,
  }) => {
    // First map continues the quick start's folder: its index.html, unchanged.
    const [html] = fences("getting-started/quick-start.mdx", "html");
    const yaml = firstMapWhole();
    expect(html).toContain('src="./map.yaml"');
    expectKnownUrls(baseURL!, html, yaml);

    const errors = await serveSnippet(page, baseURL!, "first-map", {
      "index.html": html,
      "map.yaml": yaml,
    });
    await page.goto(`/__docs/first-map/`, { waitUntil: "domcontentloaded" });
    await orReport(waitForRenderedLayer(page, "earthquakes"), errors);

    await page.evaluate(() => {
      const map = (document.querySelector("ml-map") as any).getMap();
      const at = { lng: -120, lat: 37 };
      map.fire("click", { lngLat: at, point: map.project(at) });
    });
    const popup = page.locator(".maplibregl-popup-content");
    await expect(popup.locator("h3")).toHaveText("Central California");
    await expect(popup.locator("p")).toHaveText("Magnitude 3.1");
    // The radius comes from `mag`: the 3.1 quake is drawn bigger than the 1.8 one.
    const radii = await page.evaluate(() => {
      const map = (document.querySelector("ml-map") as any).getMap();
      const r = (lng: number, lat: number) =>
        map.queryRenderedFeatures(map.project({ lng, lat }), { layers: ["earthquakes"] })[0]?.layer.paint["circle-radius"];
      return { big: r(-120, 37), small: r(-121.9, 37.4) };
    });
    expect(radii.big).toBeGreaterThan(radii.small);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("first map 'Putting it together' on a phone shows every quake", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const [html] = fences("getting-started/quick-start.mdx", "html");
    const yaml = firstMapWhole();
    const errors = await serveSnippet(page, baseURL!, "first-map-mobile", {
      "index.html": html,
      "map.yaml": yaml,
    });
    await page.goto(`/__docs/first-map-mobile/`, { waitUntil: "domcontentloaded" });
    await orReport(waitForRenderedLayer(page, "earthquakes"), errors);
    const places = await page.evaluate(() => {
      const map = (document.querySelector("ml-map") as any).getMap();
      return [...new Set(map.queryRenderedFeatures({ layers: ["earthquakes"] }).map((f: any) => f.properties.place))].sort();
    });
    expect(places).toEqual(["Central California", "Los Angeles", "San Jose"]);
    await page.screenshot({ path: "e2e/results/first-map-mobile.png" });
    expect(errors, errors.join("\n")).toEqual([]);
    await context.close();
  });

  test("web components: the Quick Start page and map.yaml render the earthquake layer", async ({
    page,
    baseURL,
  }) => {
    const [html] = fences("integrations/web-components.mdx", "html");
    expect(html).toContain('<ml-map src="map.yaml"');
    expect(html).toContain('name="viewport"');
    const [yaml] = fences("integrations/web-components.mdx", "yaml");
    expectKnownUrls(baseURL!, html, yaml);

    const errors = await serveSnippet(page, baseURL!, "wc-quick", {
      "index.html": html,
      "map.yaml": yaml,
    });
    await page.goto(`/__docs/wc-quick/`, { waitUntil: "domcontentloaded" });
    await orReport(waitForRenderedLayer(page, "quakes"), errors);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("web components: the Slots example has a height and mounts its corner chrome", async ({
    page,
    baseURL,
  }) => {
    const html = fences("integrations/web-components.mdx", "html");
    const [pageHtml] = html;
    const slots = html.find((h) => h.includes('slot="top-right"'))!;
    const [yaml] = fences("integrations/web-components.mdx", "yaml");
    expectKnownUrls(baseURL!, pageHtml, slots, yaml);
    // The quick-start page, with the Slots example in place of its <ml-map>.
    const element = pageHtml.match(/^\s*<ml-map[^\n]*<\/ml-map>\n/m)![0];
    const withSlots = pageHtml.replace(element, slots);
    expect(withSlots).toContain('slot="top-right"');

    const errors = await serveSnippet(page, baseURL!, "wc-slots", {
      "index.html": withSlots,
      "map.yaml": yaml,
    });
    await page.goto(`/__docs/wc-slots/`, { waitUntil: "domcontentloaded" });
    await orReport(waitForRenderedLayer(page, "quakes"), errors);

    const box = await page.locator("ml-map").boundingBox();
    expect(box!.height).toBe(400);
    await expect(page.locator(".my-controls")).toBeVisible();
    await expect(page.getByText("Data: USGS")).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("README (core): the CDN page + map.yaml render the earthquake layer", async ({
    page,
    baseURL,
  }) => {
    const [html] = readmeFences("packages/core/README.md", "html");
    const [yaml] = readmeFences("packages/core/README.md", "yaml");
    expect(html).toContain('src="./map.yaml"');
    expectKnownUrls(baseURL!, html, yaml);

    const errors = await serveSnippet(page, baseURL!, "readme-core", {
      "index.html": html,
      "map.yaml": yaml,
    });
    await page.goto(`/__docs/readme-core/`, { waitUntil: "domcontentloaded" });
    await orReport(waitForRenderedLayer(page, "earthquakes"), errors);
    const zoom = await page.evaluate(() => (document.querySelector("ml-map") as any).getMap().getZoom());
    expect(zoom).toBeCloseTo(5, 3);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("README (repo root): the quick-start page + map.yaml render the rivers layer", async ({
    page,
    baseURL,
  }) => {
    const [html] = readmeFences("README.md", "html");
    const [yaml] = readmeFences("README.md", "yaml");
    expect(html).toContain('src="./map.yaml"');
    expectKnownUrls(baseURL!, html, yaml);

    const errors = await serveSnippet(page, baseURL!, "readme-root", {
      "index.html": html,
      "map.yaml": yaml,
    });
    await page.goto(`/__docs/readme-root/`, { waitUntil: "domcontentloaded" });
    await orReport(waitForRenderedLayer(page, "rivers"), errors);
    const box = await page.locator("ml-map").boundingBox();
    expect(box!.height).toBe(400);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("CLI: the page `init --template basic` scaffolds renders, served as static files", async ({
    page,
    baseURL,
  }) => {
    const dir = mkdtempSync(join(tmpdir(), "mlym-e2e-init-"));
    try {
      const cli = join(__dirname, "..", "packages/cli/dist/cli.js");
      execFileSync(process.execPath, [cli, "init", "my-map", "--template", "basic"], {
        cwd: dir,
        stdio: "pipe",
      });
      const html = readFileSync(join(dir, "my-map", "index.html"), "utf8");
      const yaml = readFileSync(join(dir, "my-map", "map.yaml"), "utf8");
      // The modeline's schema URL is for editors, never fetched by the page.
      expectKnownUrls(baseURL!, html, yaml.replace(/^#.*$/gm, ""));

      const errors = await serveSnippet(page, baseURL!, "cli-basic", {
        "index.html": html,
        "map.yaml": yaml,
      });
      await page.goto(`/__docs/cli-basic/`, { waitUntil: "domcontentloaded" });
      await orReport(waitForRenderedLayer(page, "marker"), errors);
      const box = await page.locator("ml-map").boundingBox();
      expect(box!.height).toBeGreaterThan(300);

      await page.evaluate(() => {
        const map = (document.querySelector("ml-map") as any).getMap();
        const at = map.getCenter();
        map.fire("click", { lngLat: at, point: map.project(at) });
      });
      await expect(page.locator(".maplibregl-popup-content h3")).toHaveText("my-map");
      expect(errors, errors.join("\n")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("CLI: the page `init --template story` scaffolds is a working story, served as static files", async ({
    page,
    baseURL,
  }) => {
    const dir = mkdtempSync(join(tmpdir(), "mlym-e2e-init-"));
    try {
      const cli = join(__dirname, "..", "packages/cli/dist/cli.js");
      execFileSync(process.execPath, [cli, "init", "my-story", "--template", "story"], {
        cwd: dir,
        stdio: "pipe",
      });
      const html = readFileSync(join(dir, "my-story", "index.html"), "utf8");
      const yaml = readFileSync(join(dir, "my-story", "story.yaml"), "utf8");
      expectKnownUrls(baseURL!, html, yaml.replace(/^#.*$/gm, ""));

      const errors = await serveSnippet(page, baseURL!, "cli-story", {
        "index.html": html,
        "story.yaml": yaml,
      });
      await page.goto(`/__docs/cli-story/`, { waitUntil: "domcontentloaded" });
      await orReport(
        page.evaluate(() => (document.querySelector("ml-scrollytelling") as any).mapReady().then(() => null)),
        errors
      );
      await expect(page.locator(".scrolly-chapter")).toHaveCount(2);
      await expect(page.locator(".scrolly-chapter").first()).toContainText("Introduction");
      // Scroll the second chapter's card to the middle: it activates and the camera goes there.
      await page.evaluate(() => {
        const card = document.querySelector('.scrolly-chapter[data-chapter-id="chapter-1"] .chapter-content')!;
        const r = card.getBoundingClientRect();
        scrollBy(0, r.top + r.height / 2 - innerHeight / 2);
      });
      await expect(page.locator("ml-scrollytelling")).toHaveAttribute("data-active-chapter", "chapter-1");
      await expect
        .poll(() =>
          page.evaluate(() => {
            const c = (document.querySelector("ml-scrollytelling") as any).getMap().getCenter();
            return Math.abs(c.lng + 118.2437) < 0.5 && Math.abs(c.lat - 34.0522) < 0.5;
          })
        )
        .toBe(true);
      expect(errors, errors.join("\n")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
