/**
 * Grid source (ml-nb1.2, U6) — browser verification, which is also the demo
 * (examples/verification/grid-sources.html).
 *
 * @remarks
 * A `type: grid` source is decoded by the library and read by page code
 * through `getGrid(id).sample(lngLat)`; no layer draws it. The page is flat,
 * on a local style, with no custom layer, so this spec runs on every
 * MapLibre leg (4, 5 and 6). Hermetic: the grid image, the generated bad
 * PNGs and maplibre-gl all come from e2e/server.mjs. What only a real page
 * proves:
 *
 *  1. a page without a grid never downloads `chunks/grid.js` (R7);
 *  2. the happy path: the field decodes once (`source-loaded` fires once,
 *     the chunk is fetched once), and a sample read in the page equals what
 *     `decodeGrid` in Node computes from the same bytes and declaration
 *     within a byte step; the readout follows the pointer; no console error;
 *  3. the unhappy paths each put a `role="status"` notice on the map worded
 *     for a grid: 404 (with where the browser looked), CORS without the
 *     cloud readers' `Range` clause, a 60 MB file refused by Content-Length
 *     before any read (no by-view or `mlym prepare` advice), a `grid:` whose
 *     `nx` disagrees with the image (both numbers named), a 16-bit PNG (AE6),
 *     a header over the 16 M cell cap; the map keeps working under each;
 *  4. the 404 case recovers: pointing the source at the real file through
 *     `el.update()` clears the notice and fires `source-loaded`;
 *  5. a `range:` change hands out a new field from the retained bytes: no
 *     request, every sample doubled (R16).
 *
 * Requires `pnpm --filter @maplibre-yaml/core build` (the page loads dist/).
 */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PORT = Number(process.env.VERIFY_PORT ?? 4174);
const ORIGIN = `http://localhost:${PORT}`;
const PAGE = "/examples/verification/grid-sources.html";
const FILE = "examples/verification/null-earth/data/2026111400-f000-temp-2m.png";

/** The page's declaration of the ok field, for the Node-side decode it is checked against. */
const OK_SPEC = {
  type: "grid",
  encoding: "scalar-r",
  url: `/${FILE}`,
  grid: { nx: 360, ny: 181, lo1: -180, la1: 90, dx: 1, dy: 1 },
  range: [0, 100],
  nodata: { channel: "b", above: 153 },
} as const;

/** Positions sampled in the page and in Node: land, sea, a pole, both sides of the date line, between nodes. */
const PROBES: Array<[number, number]> = [
  [10, 25],
  [-30, 25],
  [90, -80],
  [179.9, 0],
  [-179.9, 0],
  [-74.25, 40.7],
  [0.5, 89.9],
];

/** Console errors the unhappy paths produce by design: the library's own report of the failure, and the browser's log of the failed request. */
const EXPECTED_CONSOLE = /\[maplibre-yaml\]|Failed to load resource|Access-Control-Allow-Origin|CORS policy/;

/** Page errors and off-origin requests (hermeticity); console errors too unless `expected` says they belong. */
async function guard(page: Page, expected?: RegExp): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (expected?.test(m.text())) return;
    errors.push(`console: ${m.text()}`);
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || /^(data|blob):/.test(url)) return route.continue();
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return errors;
}

/** Paths of every request the page makes, in order. */
function requestsOf(page: Page): string[] {
  const paths: string[] = [];
  page.on("request", (r) => paths.push(new URL(r.url()).pathname));
  return paths;
}

const chunkRequests = (paths: string[]) => paths.filter((p) => /\/chunks\/grid\.js$/.test(p));
const fileRequests = (paths: string[]) => paths.filter((p) => p.endsWith("temp-2m.png"));

async function open(page: Page, kase: string): Promise<void> {
  await page.goto(`${ORIGIN}${PAGE}?case=${kase}`);
  await page.waitForSelector("html[data-ready='1']", { timeout: 30_000 });
}

/** The map's notice (`role="status"`), once it shows — as read: its backticked spans render as code, so the text has no backticks. */
async function noticeText(page: Page): Promise<string> {
  const notice = page.locator("#map .ml-map-notice");
  await expect(notice).toHaveAttribute("role", "status");
  await expect(notice).toContainText("Source density didn't load");
  return (await notice.innerText()).replace(/\s+/g, " ");
}

/** The page's samples at the probes (null where the field has no data). */
const sampleAll = (page: Page) =>
  page.evaluate(
    (probes) => probes.map(([lng, lat]) => (window as any).__grid.el.getGrid("density").sample({ lng, lat })),
    PROBES
  ) as Promise<Array<number | null>>;

test("a page without a grid never requests the grid chunk", async ({ page }) => {
  const errors = await guard(page);
  const paths = requestsOf(page);
  await page.goto(`${ORIGIN}/examples/verification/11-background-layer.html`);
  await page.evaluate(() => (document.querySelector("ml-map") as any).mapReady());
  await page.waitForTimeout(500);
  expect(paths.some((p) => p.endsWith("/register.js") || p.includes("/dist/"))).toBe(true);
  expect(chunkRequests(paths)).toEqual([]);
  expect(paths.filter((p) => /\/chunks\//.test(p))).toEqual([]);
  expect(errors).toEqual([]);
});

test("ok: the field decodes once and samples as decodeGrid does in Node; the readout follows the pointer", async ({ page }) => {
  const errors = await guard(page);
  const paths = requestsOf(page);
  await open(page, "ok");
  const field = await page.evaluate(async () => {
    const g = (window as any).__grid;
    const f = await g.ready;
    return { kind: f.kind, nx: f.nx, ny: f.ny, wraps: f.wraps, range: [...f.range], bounds: [...f.bounds], units: f.units, same: g.el.getGrid("density") === f };
  });
  expect(field).toEqual({
    kind: "scalar",
    nx: 360,
    ny: 181,
    wraps: true,
    range: [0, 100],
    bounds: [-180.5, -90.5, 179.5, 90.5],
    units: undefined,
    same: true,
  });

  // The same bytes and declaration through the package entry in Node: equal within a byte step.
  // (A native import: the test runner's CommonJS transform can't load the ESM dist.)
  const { decodeGrid } = (await import(pathToFileURL(join(process.cwd(), "packages/core/dist/index.js")).href)) as {
    decodeGrid(bytes: ArrayBufferView, spec: unknown): Promise<{ sample(p: { lng: number; lat: number }): number | null }>;
  };
  const expected = await decodeGrid(readFileSync(join(process.cwd(), FILE)), OK_SPEC);
  const step = (OK_SPEC.range[1] - OK_SPEC.range[0]) / 255;
  const inPage = await sampleAll(page);
  for (const [i, [lng, lat]] of PROBES.entries()) {
    const want = expected.sample({ lng, lat });
    expect(typeof inPage[i], `probe ${lng},${lat}`).toBe("number");
    expect(Math.abs((inPage[i] as number) - (want as number)), `probe ${lng},${lat}`).toBeLessThan(step);
  }
  // The grid wraps: 0.2° apart across the date line, the two samples are within a byte step.
  expect(Math.abs((inPage[3] as number) - (inPage[4] as number))).toBeLessThan(step);

  // Decoded once: one source-loaded, one chunk download, one file download.
  expect(await page.evaluate(() => (window as any).__grid.loaded)).toEqual(["density"]);
  expect(chunkRequests(paths)).toHaveLength(1);
  expect(fileRequests(paths)).toHaveLength(1);

  // The readout follows the pointer.
  await expect(page.locator("#status")).toContainText("scalar field in: 360 × 181 nodes");
  const box = (await page.locator("#map canvas.maplibregl-canvas").first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("#value")).not.toHaveText("—");
  const value = Number(await page.locator("#value").textContent());
  expect(value).toBeGreaterThanOrEqual(0);
  expect(value).toBeLessThanOrEqual(100);
  await expect(page.locator("#map .ml-map-notice")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__grid.errors)).toEqual([]);
  expect(errors).toEqual([]);
});

test("404: the notice names the file, the status and where the browser looked; el.update() with the real file clears it", async ({ page }) => {
  const errors = await guard(page, EXPECTED_CONSOLE);
  await open(page, "404");
  const text = await noticeText(page);
  expect(text).toContain("didn't load (404 Not Found)");
  expect(text).toContain("f999-temp-2m.png");
  expect(text).toContain(`The browser looked for ${ORIGIN}/examples/verification/null-earth/data/2026111400-f999-temp-2m.png`);
  expect(text).not.toContain("so layer");
  // gridReady rejected with the failure; the map itself is fine; getGrid is undefined.
  expect(await page.evaluate(() => (window as any).__grid.ready.then(() => "resolved", (e: Error) => e.message))).toContain("404");
  expect(await page.evaluate(() => (window as any).__grid.el.getGrid("density"))).toBeUndefined();
  await expect(page.locator("#status")).toContainText("didn't load");

  // The file appears (the URL is corrected): the swap decodes it, the notice goes.
  const field = await page.evaluate(async () => {
    const f = await (window as any).__grid.fix();
    return { kind: f.kind, nx: f.nx };
  });
  expect(field).toEqual({ kind: "scalar", nx: 360 });
  await expect(page.locator("#map .ml-map-notice")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__grid.loaded)).toEqual(["density"]);
  await expect(page.locator("#status")).toContainText("scalar field in");
  expect(errors).toEqual([]);
});

test("nocors: the notice says CORS, and nothing about the Range header", async ({ page }) => {
  const errors = await guard(page, EXPECTED_CONSOLE);
  await open(page, "nocors");
  const text = await noticeText(page);
  expect(text).toContain("the server didn't allow this page to load it (CORS)");
  expect(text).toContain("A grid file on another site needs that site to send Access-Control-Allow-Origin.");
  expect(text).not.toContain("Range");
  expect(errors).toEqual([]);
});

test("oversize: a 60 MB file is refused by Content-Length, worded for a grid", async ({ page }) => {
  const errors = await guard(page, EXPECTED_CONSOLE);
  await open(page, "oversize");
  const text = await noticeText(page);
  expect(text).toContain("is 60 MB, more than a page loads whole (50 MB)");
  expect(text).toContain("Use a coarser grid, a smaller extent, or an 8-bit PNG");
  // None of the cloud readers' ways out: no by-view read, no `load:` / `maxFeatures` key, no conversion to tiles.
  expect(text).not.toContain("mlym prepare");
  expect(text).not.toContain("by view");
  expect(text).not.toContain("load: by-view");
  expect(text).not.toContain("load: whole");
  expect(text).not.toContain("maxFeatures");
  expect(text).not.toContain("tiles");
  expect(errors).toEqual([]);
});

test("size: a grid: whose counts disagree with the image names both", async ({ page }) => {
  const errors = await guard(page, EXPECTED_CONSOLE);
  await open(page, "size");
  const text = await noticeText(page);
  expect(text).toContain("is 360 × 181 pixels, but grid: declares nx: 100, ny: 181");
  expect(text).toContain("use bounds: [west, south, east, north]");
  expect(errors).toEqual([]);
});

test("bits (AE6): a 16-bit PNG is refused, naming its bit depth and the 8-bit requirement", async ({ page }) => {
  const errors = await guard(page, EXPECTED_CONSOLE);
  await open(page, "bits");
  const text = await noticeText(page);
  expect(text).toContain("/grid-fixtures/16bit.png is a 16-bit grayscale PNG");
  expect(text).toContain("a grid image must be an 8-bit PNG (grayscale, RGB or RGBA, not interlaced)");
  expect(errors).toEqual([]);
});

test("cells: a header over the cell cap is refused before any decoding", async ({ page }) => {
  const errors = await guard(page, EXPECTED_CONSOLE);
  await open(page, "cells");
  const text = await noticeText(page);
  expect(text).toContain("has 20,000,000 grid cells (nx × ny), more than a page decodes (16,000,000)");
  expect(text).toContain("Use a coarser grid or a smaller extent.");
  expect(errors).toEqual([]);
});

test("range: a changed range: is a new field from the same bytes — no request, samples doubled (R16)", async ({ page }) => {
  const errors = await guard(page);
  const paths = requestsOf(page);
  await open(page, "range");
  await page.evaluate(() => (window as any).__grid.ready);
  const before = await sampleAll(page);
  const requestsBefore = paths.length;
  const swapped = await page.evaluate(async () => {
    const g = (window as any).__grid;
    const old = g.el.getGrid("density");
    const next = await g.doubleRange();
    return { distinct: next !== old, range: [...next.range], oldRange: [...old.range], loaded: [...g.loaded], oldStillSamples: typeof old.sample({ lng: 10, lat: 25 }) };
  });
  expect(swapped.distinct).toBe(true);
  expect(swapped.range).toEqual([0, 200]);
  expect(swapped.oldRange).toEqual([0, 100]);
  expect(swapped.oldStillSamples).toBe("number");
  expect(swapped.loaded).toEqual(["density", "density"]);
  const after = await sampleAll(page);
  for (const [i] of PROBES.entries()) {
    expect(after[i], `probe ${i}`).toBeCloseTo(2 * (before[i] as number), 6);
  }
  // Nothing was fetched for it: not the file, not the grid chunk. (The first `el.update()` of a page
  // downloads the live-documents engine, `chunks/update.js`, once: that is the update's, not the grid's.)
  await page.waitForTimeout(300);
  expect(paths.slice(requestsBefore).filter((p) => !p.endsWith("/chunks/update.js"))).toEqual([]);
  expect(fileRequests(paths)).toHaveLength(1);
  expect(chunkRequests(paths)).toHaveLength(1);
  await expect(page.locator("#status")).toContainText("range 0..200");
  expect(errors).toEqual([]);
});
