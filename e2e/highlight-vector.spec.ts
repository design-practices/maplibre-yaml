/**
 * `hover.highlight` on vector tiles (0.9.2, ml-37r.15) — browser
 * verification, which is also the demo
 * (examples/verification/cloud-native/highlight-vector.html).
 *
 * @remarks
 * Feature-state on a vector source must name the tile layer; 0.9.1 called
 * `setFeatureState({ source, id })`, MapLibre answered every mouse move with
 * "The sourceLayer parameter must be provided for vector source types", and
 * nothing lit (the PLUTO benchmark logged it 338 times). Driven here on a
 * PMTiles archive with ids in its tiles, one without ids plus `promoteId`,
 * plain `tiles:` URLs (answered from the archive by a route), and one
 * without ids or `promoteId` — which can't light and must say why, once.
 * Runs on every maplibre-gl leg of the CI matrix.
 */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { PNG } from "pngjs";

const PAGE = "/examples/verification/cloud-native/highlight-vector.html";
const ROOT = join(__dirname, "..");
const ARCHIVE = join(ROOT, "docs/public/gallery-assets/cloud-native/districts-ids.pmtiles");

/** Page errors, console errors and warnings; off-origin requests refused. */
async function guard(page: Page) {
  const seen = { errors: [] as string[], warnings: [] as string[] };
  page.on("pageerror", (e) => seen.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") seen.errors.push(`console: ${m.text()}`);
    if (m.type() === "warning") seen.warnings.push(m.text());
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || /^(data|blob):/.test(url)) return route.continue();
    seen.errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return seen;
}

/** Answer `/vt/{z}/{x}/{y}.pbf` from the fixture archive: plain vector tiles, no PMTiles on the page. */
async function serveTiles(page: Page) {
  const require = createRequire(join(ROOT, "packages/core/package.json"));
  const { PMTiles } = (await import(pathToFileURL(require.resolve("pmtiles")).href)) as typeof import("pmtiles");
  const bytes = readFileSync(ARCHIVE);
  const archive = new PMTiles({
    getKey: () => "districts-ids",
    getBytes: async (offset: number, length: number) => ({
      data: bytes.buffer.slice(bytes.byteOffset + offset, bytes.byteOffset + offset + length),
    }),
  });
  await page.route(/\/vt\/(\d+)\/(\d+)\/(\d+)\.pbf$/, async (route) => {
    const [, z, x, y] = /\/vt\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(route.request().url())!;
    const tile = await archive.getZxy(Number(z), Number(x), Number(y));
    if (!tile) return route.fulfill({ status: 204 });
    const data = new Uint8Array(tile.data);
    const body = data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data) : Buffer.from(data);
    return route.fulfill({ status: 200, body, headers: { "content-type": "application/x-protobuf" } });
  });
}

/** Wait until the district under a map's centre is hit-testable. */
async function waitForFeatureAtCentre(page: Page, mapId: string) {
  await page.waitForFunction(
    (mapId) => {
      const map = (document.getElementById(mapId) as any)?.getMap?.();
      if (!map?.getLayer?.("districts")) return false;
      const pt = map.project(map.getCenter());
      return map.queryRenderedFeatures(pt, { layers: ["districts"] }).length > 0;
    },
    mapId,
    { timeout: 30_000 }
  );
}

/** The centre pixel of one map's canvas. */
async function centrePixel(page: Page, mapId: string): Promise<[number, number, number]> {
  const shot = await page.locator(`#${mapId} canvas.maplibregl-canvas`).screenshot();
  const png = PNG.sync.read(shot);
  const i = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
}

/** The id and hover feature-state of the district under a map's centre. */
async function hoverStateAtCentre(page: Page, mapId: string) {
  return page.evaluate((mapId) => {
    const map = (document.getElementById(mapId) as any).getMap();
    const f = map.queryRenderedFeatures(map.project(map.getCenter()), { layers: ["districts"] })[0];
    if (!f) return { id: null, state: null };
    return {
      id: f.id ?? null,
      state: f.id == null ? null : map.getFeatureState({ source: f.source, sourceLayer: f.sourceLayer, id: f.id }),
    };
  }, mapId);
}

test("hovering a district on vector tiles lights it, with or without ids in the tiles", async ({ page }) => {
  const seen = await guard(page);
  await serveTiles(page);
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await page.evaluate(() =>
    Promise.all(Array.from(document.querySelectorAll("ml-map")).map((m: any) => m.mapReady()))
  );

  const expectedIds: Record<string, unknown> = { ids: "number", promote: "string", tiles: "number" };
  for (const mapId of ["ids", "promote", "tiles"]) {
    await waitForFeatureAtCentre(page, mapId);
    const box = (await page.locator(`#${mapId} canvas.maplibregl-canvas`).boundingBox())!;
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.waitForTimeout(500);
    const before = await centrePixel(page, mapId);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect
      .poll(async () => (await hoverStateAtCentre(page, mapId)).state, {
        timeout: 10_000,
        message: `${mapId}: hover.highlight set no feature-state`,
      })
      .toMatchObject({ hover: true });
    expect(typeof (await hoverStateAtCentre(page, mapId)).id, mapId).toBe(expectedIds[mapId]);
    await page.waitForTimeout(500);
    const after = await centrePixel(page, mapId);

    // On screen: the authored red (#e63946) becomes the highlight gold (#ffd700).
    expect(before[0], `${mapId} before ${before}`).toBeGreaterThan(150);
    expect(before[1], `${mapId} before ${before}`).toBeLessThan(120);
    expect(after[0], `${mapId} after ${after}`).toBeGreaterThan(150);
    expect(after[1], `${mapId} after ${after}`).toBeGreaterThan(150);

    // Leaving the layer unlights it (the write names the tile layer too).
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.move(box.x + box.width + 40, box.y + box.height / 2);
    await expect.poll(async () => (await hoverStateAtCentre(page, mapId)).state).toMatchObject({ hover: false });
  }
  await page.screenshot({ path: "e2e/results/highlight-vector.png" });

  // The 0.9.1 failure, once per mouse move, is gone.
  expect(seen.errors.filter((e) => /sourceLayer parameter/.test(e))).toEqual([]);
  expect(seen.errors, seen.errors.join("\n")).toEqual([]);
});

test("tiles without ids: nothing lights, and the author is told once to add promoteId", async ({ page }) => {
  const seen = await guard(page);
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => (document.getElementById("noids") as any).mapReady());
  await waitForFeatureAtCentre(page, "noids");
  const box = (await page.locator("#noids canvas.maplibregl-canvas").boundingBox())!;
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(box.x + box.width / 2 + i * 15, box.y + box.height / 2 + i * 5);
    await page.waitForTimeout(80);
  }
  // An author hint on the page (served from localhost: the author is developing) …
  const notice = page.locator("#noids .ml-map-notice");
  await expect(notice).toContainText("promoteId: { districts: <property> }");
  await expect(notice).toContainText("source districts");
  // … and once on the console, however many moves.
  await expect.poll(() => seen.warnings.filter((w) => w.includes("promoteId")).length).toBe(1);
  expect(seen.warnings.filter((w) => w.includes("generateId"))).toEqual([]);
  expect((await hoverStateAtCentre(page, "noids")).id).toBeNull();
  expect(seen.errors, seen.errors.join("\n")).toEqual([]);
});
