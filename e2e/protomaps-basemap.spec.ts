/**
 * A Protomaps basemap from a `.pmtiles` file, YAML only (0.9, ml-cnv.7) —
 * browser verification, which is also the demo
 * (examples/verification/base-path/site/blog/protomaps.html and
 * protomaps-story.html, served at /my-repo/ as a GitHub Pages project site).
 *
 * @remarks
 * Fixtures (scripts/fixtures/protomaps-basemap.sh): a small Protomaps
 * extract of DUMBO / Brooklyn Heights (OpenStreetMap data), and the Noto
 * Sans glyphs and light/dark sprites its style uses. The suite stays
 * offline: the self-hosted maps name the local fonts and sprite with
 * `glyphs:`/`sprite:`, and the map on Protomaps' default asset URLs gets
 * them routed to the same local copies.
 */
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";

const PAGE = "/my-repo/blog/protomaps.html";
const STORY = "/my-repo/protomaps-story.html";
const ASSETS = join(process.cwd(), "examples/verification/base-path/site/protomaps-assets");
const HOSTED = "https://protomaps.github.io/basemaps-assets/";

/** Fail on page errors and off-origin requests; Protomaps' asset host is served from the local copies. */
async function guard(page: Page): Promise<{ errors: string[]; hosted: string[] }> {
  const errors: string[] = [];
  const hosted: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || /^(data|blob):/.test(url)) return route.continue();
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  // Registered last, so it is consulted first.
  await page.route(`${HOSTED}**`, async (route) => {
    const url = route.request().url();
    hosted.push(url);
    const file = join(ASSETS, decodeURIComponent(url.slice(HOSTED.length)));
    try {
      const body = await readFile(file);
      const type = file.endsWith(".json") ? "application/json" : file.endsWith(".png") ? "image/png" : "application/x-protobuf";
      return route.fulfill({ status: 200, body, contentType: type, headers: { "access-control-allow-origin": "*" } });
    } catch {
      return route.fulfill({ status: 404, body: "not found" });
    }
  });
  return { errors, hosted };
}

const ready = (page: Page, id: string) =>
  page.evaluate((id) => (document.getElementById(id) as any).mapReady().then(() => null), id);

/** Labels actually placed on the map (a symbol is only placed once its glyphs have loaded). */
const placedLabels = (page: Page, id: string) =>
  page.evaluate((id) => {
    const map = (document.getElementById(id) as any).getMap();
    const symbols = map
      .getStyle()
      .layers.filter((l: any) => l.type === "symbol" && l.layout?.["text-field"])
      .map((l: any) => l.id);
    return map
      .queryRenderedFeatures(undefined, { layers: symbols })
      .map((f: any) => f.properties.name)
      .filter(Boolean);
  }, id);

/** Mean luminance (0-255) of an element's screenshot. */
async function luminance(page: Page, selector: string): Promise<number> {
  const png = PNG.sync.read(await page.locator(selector).screenshot());
  let sum = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    sum += 0.2126 * png.data[i]! + 0.7152 * png.data[i + 1]! + 0.0722 * png.data[i + 2]!;
  }
  return sum / (png.data.length / 4);
}

test.describe("a Protomaps basemap from a .pmtiles file, YAML only", () => {
  test("self-hosted under /my-repo/ with base, no page JS: the basemap draws with labels, the document on top", async ({
    page,
  }) => {
    const { errors, hosted } = await guard(page);
    const files: { path: string; status: number }[] = [];
    page.on("response", (r) => {
      const path = decodeURIComponent(new URL(r.url()).pathname);
      if (/\.(pmtiles|pbf|png|json)$|\/chunks\//.test(path)) files.push({ path, status: r.status() });
    });
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof (document.getElementById("self-hosted") as any)?.mapReady === "function");
    await ready(page, "self-hosted");

    const style = await page.evaluate(() => (document.getElementById("self-hosted") as any).getMap().getStyle());
    // The file, under base, as a pmtiles:// URL; the fonts and sprite under base too.
    expect(style.sources.protomaps.url).toMatch(/^pmtiles:\/\/http:\/\/localhost:\d+\/my-repo\/protomaps\/brooklyn\.pmtiles$/);
    expect(style.glyphs).toMatch(/\/my-repo\/protomaps-assets\/fonts\/\{fontstack\}\/\{range\}\.pbf$/);
    // Basemap first, the document's layers on top; `before:` can name a Protomaps layer.
    const ids: string[] = style.layers.map((l: { id: string }) => l.id);
    expect(ids[0]).toBe("background");
    expect(ids.indexOf("earth")).toBeGreaterThan(-1);
    expect(ids[ids.length - 1]).toBe("pier-dot");
    expect(ids.indexOf("under-labels")).toBe(ids.indexOf("places_subplace") - 1);

    // Streets and places are labelled: the glyphs loaded.
    await expect.poll(() => placedLabels(page, "self-hosted"), { timeout: 45_000 }).not.toEqual([]);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const map = (document.getElementById("self-hosted") as any).getMap();
          return map.queryRenderedFeatures(undefined, { layers: ["pier-dot"] }).length;
        })
      )
      .toBe(1);
    // OpenStreetMap and Protomaps are credited.
    await expect(page.locator("#self-hosted .maplibregl-ctrl-attrib")).toContainText("OpenStreetMap");
    await expect(page.locator("#self-hosted .maplibregl-ctrl-attrib")).toContainText("Protomaps");
    await expect(page.locator("#self-hosted .ml-map-notice")).toHaveCount(0);

    // Everything came from the site, under /my-repo/, and nothing it asked for 404'd.
    const own = files.filter((f) => /\/(brooklyn\.pmtiles|protomaps-assets\/)/.test(f.path));
    expect(own.some((f) => f.path === "/my-repo/protomaps/brooklyn.pmtiles")).toBe(true);
    // The style generator and the PMTiles reader came as on-demand chunks.
    expect(files.filter((f) => /\/chunks\//.test(f.path)).map((f) => [f.path.replace(/^.*\/chunks\//, ""), f.status]).sort())
      .toEqual([["pmtiles.js", 200], ["protomaps-basemap.js", 200]]);
    expect(own.some((f) => f.path === "/my-repo/protomaps-assets/fonts/Noto Sans Regular/0-255.pbf")).toBe(true);
    expect(own.some((f) => f.path === "/my-repo/protomaps-assets/sprites/v4/light.json")).toBe(true);
    // (The fixture has the 0-255 glyph range only; other ranges may 404 harmlessly.)
    const fontRangeOnly = (p: string) => p.includes("/fonts/") && !p.endsWith("/0-255.pbf");
    expect(own.filter((f) => f.status >= 400 && !fontRangeOnly(f.path))).toEqual([]);
    expect(hosted.filter((u) => /light/.test(u))).toEqual([]);
    await page.locator("#self-hosted").screenshot({ path: "e2e/results/protomaps_self_hosted.png" });
    expect(errors).toEqual([]);
  });

  test("flavor dark (format v2 basemap:) renders differently, on Protomaps' default asset URLs", async ({ page }) => {
    const { errors, hosted } = await guard(page);
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof (document.getElementById("dark") as any)?.mapReady === "function");
    await ready(page, "self-hosted");
    await ready(page, "dark");
    for (const id of ["self-hosted", "dark"]) {
      await page.waitForFunction(
        (id) => {
          const map = (document.getElementById(id) as any).getMap();
          return map.loaded() && map.areTilesLoaded();
        },
        id,
        { timeout: 45_000 }
      );
    }
    await expect.poll(() => placedLabels(page, "dark"), { timeout: 45_000 }).not.toEqual([]);
    const bg = await page.evaluate(() =>
      ["self-hosted", "dark"].map(
        (id) => (document.getElementById(id) as any).getMap().getPaintProperty("background", "background-color")
      )
    );
    expect(bg[0]).not.toEqual(bg[1]);
    const light = await luminance(page, "#self-hosted canvas");
    const dark = await luminance(page, "#dark canvas");
    expect(light).toBeGreaterThan(150);
    expect(dark).toBeLessThan(110);
    // The defaults: Protomaps' hosted sprite for the flavor, and its fonts.
    expect(hosted.some((u) => u.endsWith("/sprites/v4/dark.json"))).toBe(true);
    expect(hosted.some((u) => u.includes("/fonts/Noto%20Sans%20"))).toBe(true);
    await page.locator("#dark").screenshot({ path: "e2e/results/protomaps_dark.png" });
    expect(errors).toEqual([]);
  });

  test("mapStyle written as just the .pmtiles file is the light basemap, not a broken style URL (ml-aot.115)", async ({
    page,
  }) => {
    const { errors, hosted } = await guard(page);
    await page.goto("/my-repo/blog/protomaps-string.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof (document.getElementById("string") as any)?.mapReady === "function");
    await ready(page, "string");
    const source = await page.evaluate(
      () => (document.getElementById("string") as any).getMap().getStyle().sources.protomaps
    );
    // base applied to the file, read through pmtiles://.
    expect(source.url).toMatch(/^pmtiles:\/\/http:\/\/localhost:\d+\/my-repo\/protomaps\/brooklyn\.pmtiles$/);
    await expect.poll(() => placedLabels(page, "string"), { timeout: 45_000 }).not.toEqual([]);
    expect(hosted.some((u) => u.endsWith("/sprites/v4/light.json"))).toBe(true);
    await expect(page.locator("#string .ml-map-error, #string .ml-map-notice")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a missing file, and a PMTiles file that isn't a Protomaps basemap, get the map's notice", async ({ page }) => {
    const { errors } = await guard(page);
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });
    const missing = page.locator("#missing .ml-map-notice");
    await expect(missing).toContainText("The basemap didn't load", { timeout: 30_000 });
    await expect(missing).toContainText("/my-repo/protomaps/not-here.pmtiles");
    await expect(missing).toContainText("didn't load (404");
    const other = page.locator("#not-basemap .ml-map-notice");
    await expect(other).toContainText("doesn't look like a Protomaps basemap", { timeout: 30_000 });
    await expect(other).toContainText("districts");
    // One notice, not MapLibre's complaint for each basemap layer the file lacks.
    expect(consoleErrors.filter((t) => /Source layer "[^"]+" does not exist/.test(t))).toEqual([]);
    await page.screenshot({ path: "e2e/results/protomaps_notices.png" });
    expect(errors).toEqual([]);
  });

  test("Protomaps' hosted fonts and icons unreachable: a notice naming the host and the glyphs:/sprite: fix (ml-cnv.16)", async ({
    page,
  }) => {
    const { errors } = await guard(page);
    // Registered after the guard's own route for the host, so consulted first.
    await page.route(`${HOSTED}**`, (route) => route.abort("connectionrefused"));
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof (document.getElementById("dark") as any)?.mapReady === "function");
    await ready(page, "dark");
    const notice = page.locator("#dark .ml-map-notice");
    await expect(notice).toContainText(
      "The basemap's labels and icons couldn't load: its fonts and icons come from protomaps.github.io, which this page couldn't reach.",
      { timeout: 30_000 }
    );
    await expect(notice).toContainText("set glyphs: and sprite: in the basemap");
    // The self-hosted map names its own copies: nothing to say there.
    await ready(page, "self-hosted");
    await expect(page.locator("#self-hosted .ml-map-notice")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("labels in a right-to-left language: MapLibre's plugin on a maplibre-gl that needs it (ml-cnv.16)", async ({
    page,
  }) => {
    const { errors } = await guard(page);
    const plugin: string[] = [];
    // A stand-in for MapLibre's right-to-left text plugin (the suite stays offline).
    await page.route("https://unpkg.com/@mapbox/mapbox-gl-rtl-text@*/**", (route) => {
      plugin.push(route.request().url());
      return route.fulfill({
        contentType: "text/javascript",
        headers: { "access-control-allow-origin": "*" },
        body:
          "self.registerRTLTextPlugin && self.registerRTLTextPlugin({ applyArabicShaping: (s) => s, " +
          "processBidirectionalText: (s) => [s], processStyledBidirectionalText: (s, st) => [[s, st]] });",
      });
    });
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />
      <link rel="stylesheet" href="/vendor/maplibre-gl.css" />
      <script type="importmap">{ "imports": { "maplibre-gl": "/vendor/maplibre-gl.esm.js" } }</script>
      </head><body>
      <ml-map id="rtl" base="/my-repo/" style="display:block;height:300px">
        <script type="text/yaml">
type: map
id: protomaps-rtl
config:
  center: [-73.9935, 40.6985]
  zoom: 14.6
  mapStyle:
    pmtiles: protomaps/brooklyn.pmtiles
    lang: ar
    glyphs: protomaps-assets/fonts/{fontstack}/{range}.pbf
    sprite: protomaps-assets/sprites/v4/light
layers: []
        </script>
      </ml-map>
      <script type="module" src="/packages/core/register.js"></script>
      </body></html>`;
    await page.route("**/my-repo/zz-rtl.html", (route) => route.fulfill({ contentType: "text/html", body: html }));
    await page.goto("/my-repo/zz-rtl.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof (document.getElementById("rtl") as any)?.mapReady === "function");
    await ready(page, "rtl");
    const { version, status } = await page.evaluate(async () => {
      const mod: any = await import("/vendor/maplibre-gl.esm.js" as string);
      const gl = mod.default ?? mod;
      return { version: gl.getVersion(), status: gl.getRTLTextPluginStatus?.() };
    });
    const [major, minor] = version.split(".").map(Number);
    if (major > 6 || (major === 6 && minor >= 9)) {
      // maplibre-gl 6.9+ draws Arabic itself: no plugin.
      expect(status).toBe("unavailable");
      expect(plugin).toEqual([]);
    } else {
      // Set, lazily: it downloads when an Arabic label is about to be drawn.
      expect(status).not.toBe("unavailable");
    }
    expect(errors).toEqual([]);
  });

  test("the generator chunk blocked: a notice, and the document's own layers still draw", async ({ page }) => {
    const { errors } = await guard(page);
    const asked: string[] = [];
    await page.route("**/chunks/protomaps-basemap.js*", (route) => {
      asked.push(route.request().url());
      return route.abort("blockedbyclient");
    });
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });
    const notice = page.locator("#self-hosted .ml-map-notice");
    await expect(notice).toContainText("Protomaps basemap reader", { timeout: 30_000 });
    await expect(notice).toContainText("couldn't be downloaded");
    await ready(page, "self-hosted");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const map = (document.getElementById("self-hosted") as any).getMap();
          return map.queryRenderedFeatures(undefined, { layers: ["pier-dot"] }).length;
        })
      )
      .toBe(1);
    expect(asked.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("the PMTiles reader blocked: the basemap notice, and mapReady() still resolves", async ({ page }) => {
    const { errors } = await guard(page);
    await page.route("**/chunks/pmtiles.js*", (route) => route.abort("blockedbyclient"));
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof (document.getElementById("self-hosted") as any)?.mapReady === "function");
    const settled = await page.evaluate(() =>
      Promise.race([
        (document.getElementById("self-hosted") as any).mapReady().then(
          () => "ready",
          () => "rejected"
        ),
        new Promise((resolve) => setTimeout(() => resolve("TIMEOUT"), 20_000)),
      ])
    );
    expect(settled).toBe("ready");
    const notice = page.locator("#self-hosted .ml-map-notice");
    await expect(notice).toContainText("The basemap didn't load: The PMTiles reader (");
    await expect(notice).toContainText("couldn't be downloaded");
    expect(errors).toEqual([]);
  });

  test("a story on a Protomaps basemap: a chapter restyles a basemap layer by id", async ({ page }) => {
    const { errors } = await guard(page);
    await page.goto(STORY, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof (document.querySelector("ml-scrollytelling") as any)?.mapReady === "function");
    await page.evaluate(() => (document.querySelector("ml-scrollytelling") as any).mapReady().then(() => null));
    const onMap = (body: string) =>
      page.evaluate(
        (b) => new Function("map", `return (${b})`)((document.querySelector("ml-scrollytelling") as any).getMap()),
        body
      );
    const active = () =>
      page.evaluate(() => (document.querySelector("ml-scrollytelling") as HTMLElement).dataset.activeChapter ?? null);
    const scrollTo = async (id: string) => {
      for (let i = 0; i < 80; i++) {
        const d = await page.evaluate((chapterId) => {
          const s = document.querySelector(`.scrolly-chapter[data-chapter-id="${chapterId}"]`)!;
          const c = (s.querySelector(".chapter-content") ?? s).getBoundingClientRect();
          return c.top + c.height / 2 - innerHeight / 2;
        }, id);
        if (Math.abs(d) < 40) break;
        await page.evaluate((y) => scrollBy(0, y), Math.max(-400, Math.min(400, d)));
        await page.waitForTimeout(60);
      }
      await expect.poll(active, { message: `chapter ${id} active` }).toBe(id);
    };

    await expect.poll(() => onMap(`map.getSource("protomaps")?.url ?? null`)).toMatch(/\/my-repo\/protomaps\/brooklyn\.pmtiles$/);
    await scrollTo("dumbo");
    expect(await onMap(`map.getPaintProperty("water", "fill-color")`)).toBe("#80deea");
    await scrollTo("river");
    await expect.poll(() => onMap(`map.getPaintProperty("water", "fill-color")`)).toBe("#d62828");
    await scrollTo("dumbo");
    await expect.poll(() => onMap(`map.getPaintProperty("water", "fill-color")`)).toBe("#80deea");
    await expect(page.locator(".scrolly-error, .ml-map-error")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
