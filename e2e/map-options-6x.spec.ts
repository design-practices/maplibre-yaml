/**
 * `config:` map options in the shape maplibre-gl 6.15–6.16 gave them
 * (ml-vwz) — browser verification and demo
 * (examples/verification/map-options-6x.html).
 *
 * Hermetic: the basemap is the local style; any off-origin request fails the
 * test. What only a real map proves:
 *
 *  1. `dragRotate: { around: pointer }` reaches MapLibre's handler as
 *     written: the map's `dragRotate` handler reports `around: "pointer"`
 *     (6.15 `DragRotateOptions`), and the handler is enabled;
 *  2. `maxBounds: [-.inf, -60, .inf, 75]` constrains one axis: the map's
 *     `getMaxBounds()` is open west/east and finite north/south, a jump to
 *     85°N is clamped under 75°N, and a jump to 170°E keeps its longitude
 *     (6.16 `setMaxBounds`: "an unconstrained longitude range, with finite
 *     latitude limits");
 *  3. neither map shows an error card, and no console error or page error.
 *
 * Both shapes need maplibre-gl 6.16; on an older vendor the whole file is
 * skipped (the renderer degrades there — unit-tested in
 * packages/core/tests/renderer/map-renderer-map-options.test.ts).
 * VERIFY_MAPLIBRE_DIR serves another install locally (see e2e/server.mjs).
 */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MAPLIBRE_DIR = process.env.VERIFY_MAPLIBRE_DIR ?? join(process.cwd(), "node_modules/maplibre-gl");
const VENDOR_VERSION: string = JSON.parse(readFileSync(join(MAPLIBRE_DIR, "package.json"), "utf8")).version;
const [MAJOR = 0, MINOR = 0] = VENDOR_VERSION.split(".").map(Number);

test.skip(MAJOR < 6 || (MAJOR === 6 && MINOR < 16), `dragRotate options and an open-longitude maxBounds need maplibre-gl >= 6.16 (vendor ${VENDOR_VERSION})`);

/** Fail the test on any page error, console error or off-origin request. */
async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || /^(data|blob):/.test(url)) return route.continue();
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return errors;
}

test("dragRotate around the pointer and a one-axis maxBounds reach MapLibre as written", async ({ page }) => {
  const errors = await guard(page);
  await page.goto("/examples/verification/map-options-6x.html", { waitUntil: "domcontentloaded" });

  const r = await page.evaluate(async () => {
    const rotate = await (document.getElementById("rotate") as any).mapReady();
    const band = await (document.getElementById("band") as any).mapReady();
    const handler = rotate.dragRotate;
    const max = band.getMaxBounds();
    band.jumpTo({ center: [10, 85], zoom: 3 });
    const north = band.getCenter();
    band.jumpTo({ center: [170, 20], zoom: 3 });
    const east = band.getCenter();
    band.jumpTo({ center: [0, -80], zoom: 3 });
    const south = band.getCenter();
    return {
      around: handler.around,
      enabled: handler.isEnabled(),
      max: max ? [max.getWest(), max.getSouth(), max.getEast(), max.getNorth()].map((v: number) => (Number.isFinite(v) ? v : String(v))) : null,
      north: north.lat,
      eastLng: east.lng,
      south: south.lat,
      version: (window as any).maplibregl?.getVersion?.() ?? null,
    };
  });

  await expect(page.locator(".ml-map-error")).toHaveCount(0);
  // 1. the handler got the options object
  expect(r.around).toBe("pointer");
  expect(r.enabled).toBe(true);
  // 2. one open axis: longitude unconstrained, latitude finite — and honoured
  expect(r.max).toEqual(["-Infinity", -60, "Infinity", 75]);
  expect(r.north).toBeLessThan(75);
  expect(r.north).toBeGreaterThan(60);
  expect(r.eastLng).toBeCloseTo(170, 3);
  expect(r.south).toBeGreaterThan(-60);
  expect(r.south).toBeLessThan(-40);
  await page.screenshot({ path: "e2e/results/small_map-options-6x.png" });
  // 3. no errors anywhere
  expect(errors).toEqual([]);
});
