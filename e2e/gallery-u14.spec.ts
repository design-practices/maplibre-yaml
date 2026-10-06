/**
 * U14 gallery gaps — browser verification, which is also the demo.
 *
 * @remarks
 * The three cheap gaps the 0.7 gallery close-out flips to YAML, each
 * proven on its hermetic twin (examples/gallery/configs/, driven through
 * examples/gallery/viewer.html — the page a human opens is the page this
 * suite drives):
 *
 * - `fit-to-the-bounds-of-a-linestring` — `config.fitTo` frames the camera
 *   on a source's data (inline: constructed framed; fetched: framed on the
 *   first load), and the camera emit computes for the reference viewport is
 *   the camera MapLibre itself fits at that size.
 * - `add-a-color-relief-layer` — the `color-relief` layer type paints an
 *   elevation ramp on maplibre-gl ≥ 5.6, and declares absence (one warning,
 *   no error) below it — the CI matrix's 4.x leg asserts that half.
 * - `display-a-popup` — a popup open at a coordinate with no layer and no
 *   marker, trust-gated content, MapLibre close semantics.
 */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { meetsVersion, COLOR_RELIEF_RUNTIME_FLOOR } from "../packages/core/src/capabilities";
import { cameraForBounds, FIT_TO_REFERENCE_VIEWPORT } from "../packages/core/src/emitter/lower-fit-to";

/** The vendored maplibre-gl version (the CI matrix overrides it per leg). */
const VENDOR_MAPLIBRE_VERSION: string = JSON.parse(
  readFileSync(join(process.cwd(), "node_modules/maplibre-gl/package.json"), "utf8")
).version;
const vendorHasColorRelief = () => meetsVersion(VENDOR_MAPLIBRE_VERSION, COLOR_RELIEF_RUNTIME_FLOOR);

/** The route's bounds, as the twin's coordinates span them. */
const ROUTE_BOUNDS: [[number, number], [number, number]] = [
  [-77.0366048812866, 38.88989712255097],
  [-77.00813055038452, 38.89876515143842],
];

/** Fail the test on any page error or off-origin request (hermeticity). */
async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || url.startsWith("data:")) {
      return route.continue();
    }
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return errors;
}

async function openExample(page: Page, slug: string, layers: string[]): Promise<void> {
  await page.goto(`/examples/gallery/viewer.html?example=${slug}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    (ids) => {
      const map = (document.getElementById("map") as any)?.getMap?.();
      if (!map || !map.isStyleLoaded?.()) return false;
      return ids.every((id: string) => Boolean(map.getLayer?.(id)));
    },
    layers,
    { timeout: 60_000 }
  );
}

/** Record every `ml-map:camera-fit` detail, from before the page's scripts run. */
async function recordFits(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__fits = [];
    document.addEventListener("ml-map:camera-fit", (e) =>
      (window as any).__fits.push((e as CustomEvent).detail)
    );
  });
}

/** Whether the live viewport contains the route bounds, and the zoom. */
function framing(page: Page) {
  return page.evaluate((b) => {
    const map = (document.getElementById("map") as any).getMap();
    const v = map.getBounds();
    return {
      zoom: map.getZoom() as number,
      contains:
        v.getWest() <= b[0][0] &&
        v.getSouth() <= b[0][1] &&
        v.getEast() >= b[1][0] &&
        v.getNorth() >= b[1][1],
    };
  }, ROUTE_BOUNDS);
}

test.describe("fitTo: the initial camera frames a source's data (U14, ml-chh.9)", () => {
  test("fit-to-the-bounds-of-a-linestring: an inline source is framed from construction", async ({
    page,
  }) => {
    const errors = await guard(page);
    await recordFits(page);
    await openExample(page, "fit-to-the-bounds-of-a-linestring", ["route"]);

    // The authored camera is zoom 2 at [0, 0]; only fitTo puts the route on screen.
    const { zoom, contains } = await framing(page);
    expect(contains, "the viewport does not contain the route").toBe(true);
    expect(zoom).toBeGreaterThan(12);
    await page.waitForFunction(
      () =>
        ((document.getElementById("map") as any)
          .getMap()
          .queryRenderedFeatures(undefined, { layers: ["route"] }) ?? []).length > 0,
      undefined,
      { timeout: 30_000 }
    );
    const fits = await page.evaluate(() => (window as any).__fits);
    expect(fits).toEqual([{ source: "route", bounds: ROUTE_BOUNDS }]);
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("the camera emit computes is the camera MapLibre fits at the reference viewport", async ({
    page,
  }) => {
    const errors = await guard(page);
    const { width, height } = FIT_TO_REFERENCE_VIEWPORT;
    await page.setViewportSize({ width, height: height + 200 });
    await openExample(page, "fit-to-the-bounds-of-a-linestring", ["route"]);

    // Resize the map to exactly the reference viewport, then ask MapLibre
    // for its own fit — the emitted camera must match it.
    const live = await page.evaluate(
      ({ bounds, h }) => {
        const el = document.getElementById("map") as HTMLElement;
        el.style.width = `${document.documentElement.clientWidth}px`;
        el.style.height = `${h}px`;
        const map = (el as any).getMap();
        map.resize();
        const canvas = map.getCanvas();
        const camera = map.cameraForBounds(bounds, { padding: 20 });
        return {
          size: [canvas.clientWidth, canvas.clientHeight],
          center: [camera.center.lng, camera.center.lat],
          zoom: camera.zoom,
        };
      },
      { bounds: ROUTE_BOUNDS, h: height }
    );
    expect(live.size).toEqual([width, height]);

    const emitted = cameraForBounds(ROUTE_BOUNDS, FIT_TO_REFERENCE_VIEWPORT, 20);
    expect(emitted.zoom).toBeCloseTo(live.zoom, 1);
    expect(emitted.center[0]).toBeCloseTo(live.center[0], 4);
    expect(emitted.center[1]).toBeCloseTo(live.center[1], 4);
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("a fetched source is framed once its first load lands", async ({ page }) => {
    const errors = await guard(page);
    await recordFits(page);
    await openExample(page, "fit-to-a-fetched-source", ["route"]);

    await page.waitForFunction(() => (window as any).__fits.length > 0, undefined, {
      timeout: 30_000,
    });
    const { zoom, contains } = await framing(page);
    expect(contains, "the viewport does not contain the fetched route").toBe(true);
    expect(zoom).toBeGreaterThan(12);
    expect(await page.evaluate(() => (window as any).__fits.length)).toBe(1);
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});

test.describe("color-relief: the elevation ramp layer type (U14, ml-chh.8)", () => {
  test("add-a-color-relief-layer: the ramp paints across the hills (maplibre-gl >= 5.6)", async ({
    page,
  }) => {
    test.skip(
      !vendorHasColorRelief(),
      `color-relief needs maplibre-gl >= ${COLOR_RELIEF_RUNTIME_FLOOR} (vendor is ${VENDOR_MAPLIBRE_VERSION})`
    );
    const errors = await guard(page);
    await openExample(page, "add-a-color-relief-layer", ["color-relief"]);
    await page.waitForFunction(
      () => {
        const map = (document.getElementById("map") as any).getMap();
        return map.loaded() && map.areTilesLoaded();
      },
      undefined,
      { timeout: 60_000 }
    );

    // Sample a grid of pixels: the ramp must show both its low (blue) and
    // high (red/orange) ends — a flat or unpainted layer shows one color.
    const sample = await page.evaluate(() => {
      const map = (document.getElementById("map") as any).getMap();
      map.triggerRepaint();
      const canvas = map.getCanvas() as HTMLCanvasElement;
      const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext;
      const px = new Uint8Array(4);
      let blue = 0;
      let warm = 0;
      const colors = new Set<string>();
      for (let i = 1; i < 20; i++) {
        for (let j = 1; j < 20; j++) {
          const x = Math.floor((gl.drawingBufferWidth * i) / 20);
          const y = Math.floor((gl.drawingBufferHeight * j) / 20);
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const [r, g, b] = px as unknown as number[];
          colors.add(`${r >> 4},${g >> 4},${b >> 4}`);
          if (b > r + 60 && b > g) blue++;
          if (r > b + 60 && r >= g * 0.5) warm++;
        }
      }
      return { blue, warm, distinct: colors.size };
    });
    expect(sample.blue, "no low-elevation (blue) pixels painted").toBeGreaterThan(0);
    expect(sample.warm, "no high-elevation (warm) pixels painted").toBeGreaterThan(0);
    expect(sample.distinct).toBeGreaterThan(5);
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("below 5.6 the layer declares absence: skipped, ONE warning, no error", async ({
    page,
  }) => {
    test.skip(vendorHasColorRelief(), "this leg renders color-relief; the absence posture belongs to the v4 leg");
    const errors = await guard(page);
    const warnings: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "warning") warnings.push(m.text());
    });
    await openExample(page, "add-a-color-relief-layer", []);
    await page.waitForFunction(() => (document.getElementById("map") as any).getMap().loaded(), undefined, {
      timeout: 30_000,
    });

    const hasLayer = await page.evaluate(() =>
      Boolean((document.getElementById("map") as any).getMap().getLayer("color-relief"))
    );
    expect(hasLayer).toBe(false);
    expect(warnings.filter((w) => w.includes("color-relief"))).toHaveLength(1);
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});

test.describe("popups: a popup at a coordinate, no layer, no marker (U14)", () => {
  test("display-a-popup: open from load, trust-gated content, closeOnClick honored", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openExample(page, "display-a-popup", []);

    const popup = page.locator(".maplibregl-popup");
    await expect(popup).toHaveCount(1);
    await expect(popup.locator("h1")).toHaveText("Hello World!");
    await expect(page.locator(".maplibregl-marker")).toHaveCount(0);

    // closeOnClick: false — a map click leaves it open...
    await page.locator("#map canvas.maplibregl-canvas").click({ position: { x: 40, y: 40 } });
    await expect(popup).toHaveCount(1);
    // ...and the close button (MapLibre's default) dismisses it.
    await popup.locator(".maplibregl-popup-close-button").click();
    await expect(popup).toHaveCount(0);
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});
