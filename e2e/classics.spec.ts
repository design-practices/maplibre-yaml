/**
 * The Mapzen classics launch page (U11, AE3) — the BUILT docs page, driven
 * in a browser.
 *
 * @remarks
 * e2e/server.mjs mounts docs/dist at the paths the site serves the page
 * from (/examples/classics/, /classics/, /_astro/), so this is the page as deployed: its live
 * panes (`<ml-map>` + `@maplibre-yaml/effects`, bundled by the docs build)
 * and its exported panes (vanilla maplibre-gl over the `mlym emit` output the
 * docs build wrote). Build the docs first: `pnpm build`.
 *
 * Hermetic. The page's documents name their real hosts, so every off-origin
 * request is answered here or fails the test:
 *  - https://docs.maplibre-yaml.org/…  → the built site (docs/dist): the
 *    textures, sprites and glyphs this build deploys;
 *  - https://tiles.openfreemap.org/planet → a TileJSON for the vendored
 *    lower-Manhattan fixture (OpenStreetMap, ODbL);
 *  - https://tiles.openfreemap.org/fonts/… → an empty glyph range;
 *  - the site-wide unpkg maplibre-gl stylesheet → an empty sheet.
 *
 * Asserted per classic: both panes render the city; the live pane's effect
 * is attached and drawing while the exported pane runs plain maplibre-gl with
 * no effect anywhere in its style; dragging either pane moves the other; a
 * phone-width viewport stacks the panes and keeps them synced; the download
 * links serve the document and the exported style.
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "docs", "dist");
/** The maplibre-gl the docs build bundled (the CI matrix overrides it). */
const V5 =
  Number(JSON.parse(readFileSync(join(ROOT, "docs/node_modules/maplibre-gl/package.json"), "utf8")).version.split(".")[0]) >= 5;
const PORT = Number(process.env.VERIFY_PORT ?? 4174);
const ORIGIN = `http://localhost:${PORT}`;
const SITE = "https://docs.maplibre-yaml.org";
const CLASSICS = [
  { name: "crosshatch", effect: "tonal-hatch" },
  { name: "blueprint", effect: "blueprint" },
] as const;

const TILEJSON = {
  tilejson: "3.0.0",
  tiles: [`${ORIGIN}/examples/gallery/fixtures/omt/{z}/{x}/{y}.pbf`],
  minzoom: 13,
  maxzoom: 14,
  bounds: [-74.035, 40.695, -73.985, 40.735],
};

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".json": "application/json",
  ".pbf": "application/x-protobuf",
  ".yaml": "text/yaml",
};

/** Route every request; fail the test on page errors or unlisted hosts. */
async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.route("**/*", async (route: Route) => {
    const url = new URL(route.request().url());
    const cors = { "access-control-allow-origin": "*" };
    if (/^(localhost|127\.0\.0\.1)$/.test(url.hostname) || /^(data|blob):/.test(url.protocol)) {
      return route.continue();
    }
    if (url.origin === SITE) {
      // Off production, neither pane may fetch from the production origin:
      // on a PR preview (or before a deploy) those URLs 404 for anything new
      // — the maintainer saw crosshatch's exported pane with roads and labels
      // only (sprite), and the live pane's hatch atlas is not deployed yet.
      // Mapping the production origin to the local build here is what hid
      // that, so any such request is an error (served anyway, so one miss
      // doesn't cascade).
      errors.push(`fetched from the production origin (404s on previews): ${url.href}`);
      const file = join(DIST, decodeURIComponent(url.pathname));
      if (!file.startsWith(DIST) || !existsSync(file)) {
        errors.push(`not in the docs build: ${url.href}`);
        return route.fulfill({ status: 404, headers: cors, body: "not found" });
      }
      const ext = file.slice(file.lastIndexOf("."));
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": MIME[ext] ?? "application/octet-stream" }, body: readFileSync(file) });
    }
    if (url.href === "https://tiles.openfreemap.org/planet") {
      return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify(TILEJSON) });
    }
    // The site-wide <head> stylesheet (astro.config.mjs). The page bundles
    // its own maplibre-gl CSS, so an empty sheet stands in.
    if (url.href === "https://unpkg.com/maplibre-gl@4.1.0/dist/maplibre-gl.css") {
      return route.fulfill({ status: 200, headers: cors, contentType: "text/css", body: "" });
    }
    if (url.origin === "https://tiles.openfreemap.org" && url.pathname.startsWith("/fonts/")) {
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/x-protobuf" }, body: Buffer.alloc(0) });
    }
    errors.push(`external request (suite must stay hermetic): ${url.href}`);
    return route.abort();
  });
  return errors;
}

/** Open the page and wait until every classic's two maps exist and are synced. */
async function openPage(page: Page): Promise<void> {
  expect(
    existsSync(join(DIST, "examples", "classics", "index.html")),
    "docs/dist/examples/classics/index.html is missing — build the docs first (pnpm build)"
  ).toBe(true);
  await page.goto("/examples/classics/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    (n) => document.querySelectorAll('section.classic[data-ready="true"]').length === n,
    CLASSICS.length,
    { timeout: 60_000 }
  );
}

type Probe = {
  live: { layers: string[]; roads: number; loaded: boolean };
  exported: { layers: string[]; roads: number; buildings: number; loaded: boolean; styleText: string; insideMlMap: boolean };
};

/** Both maps of one classic: layers, features on screen, style contents. */
const probe = (page: Page, name: string) =>
  page.evaluate((n): Probe => {
    const section = document.querySelector(`section.classic[data-classic="${n}"]`) as any;
    const { live, exported } = section.__maps;
    const count = (m: any, id: string) => m.queryRenderedFeatures(undefined, { layers: [id] }).length;
    return {
      live: {
        layers: live.getStyle().layers.map((l: any) => l.id),
        roads: count(live, "roads"),
        loaded: live.loaded(),
      },
      exported: {
        layers: exported.getStyle().layers.map((l: any) => l.id),
        roads: count(exported, "roads"),
        buildings: count(exported, "buildings"),
        loaded: exported.loaded(),
        styleText: JSON.stringify(exported.getStyle()),
        insideMlMap: Boolean(exported.getContainer().closest("ml-map")),
      },
    };
  }, name);

const camera = (page: Page, name: string, pane: "live" | "exported") =>
  page.evaluate(
    ([n, p]) => {
      const m = (document.querySelector(`section.classic[data-classic="${n}"]`) as any).__maps[p];
      const c = m.getCenter();
      return { lng: c.lng, lat: c.lat, zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() };
    },
    [name, pane] as const
  );

/** Drag the middle of one pane's canvas by (dx, dy) CSS pixels. */
async function drag(page: Page, name: string, pane: "live" | "exported", dx: number, dy: number) {
  const canvas = page.locator(`section.classic[data-classic="${name}"] [data-pane="${pane}"] canvas.maplibregl-canvas`);
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y + (dy * i) / 8);
  await page.mouse.up();
}

/** Both cameras equal (center to ~1 cm, the rest to float noise). */
async function expectSynced(page: Page, name: string) {
  await expect
    .poll(async () => {
      const [a, b] = [await camera(page, name, "live"), await camera(page, name, "exported")];
      return (
        Math.abs(a.lng - b.lng) < 1e-7 &&
        Math.abs(a.lat - b.lat) < 1e-7 &&
        Math.abs(a.zoom - b.zoom) < 1e-9 &&
        Math.abs(a.bearing - b.bearing) < 1e-9 &&
        Math.abs(a.pitch - b.pitch) < 1e-9
      );
    })
    .toBe(true);
}

/** Drag one pane, assert it moved and the other pane followed exactly. */
async function expectDragSyncs(page: Page, name: string, pane: "live" | "exported") {
  const before = await camera(page, name, pane);
  await drag(page, name, pane, -140, 60);
  const after = await camera(page, name, pane);
  expect(Math.abs(after.lng - before.lng) + Math.abs(after.lat - before.lat), `${pane} pane did not pan`).toBeGreaterThan(1e-4);
  await expectSynced(page, name);
}

test.describe("Mapzen classics launch page (U11)", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1280, height: 900 } });

  for (const { name, effect } of CLASSICS) {
    test(`${name}: live pane runs ${effect}; exported pane runs the emitted style in plain maplibre-gl`, async ({ page }) => {
      const errors = await guard(page);
      await openPage(page);

      // Both panes put the city on screen.
      await page.waitForFunction(
        (n) => {
          const { live, exported } = (document.querySelector(`section.classic[data-classic="${n}"]`) as any).__maps;
          const roads = (m: any) => m.queryRenderedFeatures(undefined, { layers: ["roads"] }).length;
          return roads(live) > 0 && roads(exported) > 0 &&
            exported.queryRenderedFeatures(undefined, { layers: ["buildings"] }).length > 0;
        },
        name,
        { timeout: 60_000 }
      );
      const p = await probe(page, name);
      // Both panes are full-size maps (the live one once collapsed to a sliver
      // when the element lost the component's scoped styles).
      const sec = `section.classic[data-classic="${name}"]`;
      const liveBox = (await page.locator(`${sec} [data-pane="live"]`).boundingBox())!;
      const exportedBox = (await page.locator(`${sec} [data-pane="exported"]`).boundingBox())!;
      expect(liveBox.height).toBeGreaterThan(300);
      expect(Math.abs(liveBox.height - exportedBox.height)).toBeLessThan(2);
      // …that sit level and whose canvas fills them (Starlight's flow margins
      // once pushed the live map down inside its element).
      expect(Math.abs(liveBox.y - exportedBox.y)).toBeLessThan(2);
      for (const box of [liveBox, exportedBox]) {
        const canvas = (await page.locator(`${sec} canvas.maplibregl-canvas`).nth(box === liveBox ? 0 : 1).boundingBox())!;
        expect(Math.abs(canvas.y - box.y), "map canvas offset inside its pane").toBeLessThan(2);
      }
      // Same document, same layers, same order: the export drops nothing.
      expect(p.exported.layers).toEqual(p.live.layers.filter((id) => p.exported.layers.includes(id)));
      expect(p.exported.layers).toContain("buildings");
      // The exported pane is vanilla maplibre-gl over the emitted file:
      // outside any <ml-map>, with no effect anywhere in its style, and the
      // exact style.json the docs build wrote.
      expect(p.exported.insideMlMap).toBe(false);
      expect(p.exported.styleText).not.toContain('"effect"');
      const emitted = JSON.parse(readFileSync(join(DIST, "classics", name, "exported", "style.json"), "utf8"));
      expect(emitted.layers.map((l: any) => l.id)).toEqual(p.exported.layers);

      const status = page.locator(`section.classic[data-classic="${name}"] [data-fx-status]`);
      const fx = async () =>
        page.evaluate(
          (n) =>
            (document.querySelector(`section.classic[data-classic="${n}"]`) as any)
              .__effects()
              .map((e: any) => ({ layerId: e.layerId, type: e.type, active: e.active, tiles: e.handle?.stats?.tilesDrawn ?? 0 })),
          name
        );
      if (V5) {
        // The live pane's effect attached and is drawing (not declared absent).
        await expect(status).toHaveAttribute("data-state", "on", { timeout: 60_000 });
        await expect(status).toContainText(effect);
        const attached = await fx();
        expect(attached).toEqual([{ layerId: "buildings", type: effect, active: true, tiles: expect.any(Number) }]);
        expect(attached[0]!.tiles).toBeGreaterThan(0);
      } else {
        // maplibre-gl 4 (the CI matrix leg): the effect declares absence and
        // the page says so; the document's static buildings still draw.
        await expect(status).toHaveAttribute("data-state", "static", { timeout: 60_000 });
        await expect(status).toContainText("static fallback");
        expect(await fx()).toEqual([{ layerId: "buildings", type: effect, active: false, tiles: 0 }]);
        expect(
          await page.evaluate(
            (n) =>
              (document.querySelector(`section.classic[data-classic="${n}"]`) as any).__maps.live
                .queryRenderedFeatures(undefined, { layers: ["buildings"] }).length,
            name
          )
        ).toBeGreaterThan(0);
      }

      expect(errors, errors.join("\n")).toEqual([]);
    });
  }

  test("camera sync: dragging either pane moves the other, both directions", async ({ page }) => {
    const errors = await guard(page);
    await openPage(page);
    for (const { name } of CLASSICS) {
      await expectSynced(page, name);
      await expectDragSyncs(page, name, "live");
      await expectDragSyncs(page, name, "exported");
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("download links serve the document and its exported style", async ({ page }) => {
    const errors = await guard(page);
    await openPage(page);
    for (const { name } of CLASSICS) {
      const section = page.locator(`section.classic[data-classic="${name}"]`);
      const doc = await section.locator('a[data-download="document"]').getAttribute("href");
      const style = await section.locator('a[data-download="exported"]').getAttribute("href");
      expect(doc).toBe(`/classics/${name}.yaml`);
      expect(style).toBe(`/classics/${name}/exported/style.json`);

      const docRes = await page.request.get(doc!);
      expect(docRes.status()).toBe(200);
      expect(await docRes.text()).toBe(readFileSync(join(ROOT, "docs/public/classics", `${name}.yaml`), "utf8"));
      const styleRes = await page.request.get(style!);
      expect(styleRes.status()).toBe(200);
      expect(JSON.parse(await styleRes.text()).version).toBe(8);
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("Mapzen classics launch page (U11), phone width", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: false });

  test("the panes stack vertically and stay synced", async ({ page }) => {
    const errors = await guard(page);
    await openPage(page);
    for (const { name } of CLASSICS) {
      const live = (await page.locator(`section.classic[data-classic="${name}"] [data-pane="live"]`).boundingBox())!;
      const exported = (await page.locator(`section.classic[data-classic="${name}"] [data-pane="exported"]`).boundingBox())!;
      // Stacked: exported below live, same column, each (nearly) full width.
      expect(exported.y).toBeGreaterThanOrEqual(live.y + live.height);
      expect(Math.abs(exported.x - live.x)).toBeLessThan(2);
      expect(live.width).toBeGreaterThan(300);
      await expectDragSyncs(page, name, "exported");
      await expectDragSyncs(page, name, "live");
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
