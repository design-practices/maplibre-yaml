/**
 * Large FlatGeobuf and GeoParquet files (0.9.2, ml-37r.16 and ml-37r.17) —
 * browser verification, which is also the demo
 * (examples/verification/cloud-native/large-files.html).
 *
 * @remarks
 * The PLUTO benchmark found two ways a big file took the tab down with no
 * word on the page: GeoParquet's whole-file guard counted compressed bytes
 * (857k rows passed as 47 MB and were decoded on the page), and
 * `load: viewport` had no limit per view (the citywide view read the whole
 * file, again on every pan). The page lowers the whole-file feature limit
 * through the browser-test hook so the committed fixtures stand in for large
 * files, and sets a small `maxFeatures` for the by-view case.
 * Runs on every maplibre-gl leg of the CI matrix.
 */
import { test, expect, type Page } from "@playwright/test";

const PAGE = "/examples/verification/cloud-native/large-files.html";

async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || /^(data|blob):/.test(url)) return route.continue();
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return errors;
}

/** Bytes requested per fixture (from the Range header, or the response size for a whole GET). */
function recordBytes(page: Page) {
  const seen: { file: string; bytes: number }[] = [];
  page.on("response", async (r) => {
    const m = /\/gallery-assets\/cloud-native\/(points\.(?:fgb|parquet))$/.exec(r.url());
    if (!m) return;
    const range = /bytes=(\d*)-(\d*)/.exec(r.request().headers()["range"] ?? "");
    const bytes = range && range[1] && range[2] ? Number(range[2]) - Number(range[1]) + 1 : Number(r.headers()["content-length"] ?? 0);
    seen.push({ file: m[1]!, bytes });
  });
  return seen;
}

const OPEN = async (page: Page, ...ids: string[]) => {
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  for (const id of ids) await page.evaluate((id) => (document.getElementById(id) as any).mapReady(), id);
};

/** How many features each source of a map holds now. */
function counts(page: Page, mapId: string, sources: string[]) {
  return page.evaluate(
    ({ mapId, sources }) => {
      const map = (document.getElementById(mapId) as any).getMap();
      return Object.fromEntries(
        sources.map((s) => [s, (map.getSource(s) as any)?._data?.features?.length ?? map.querySourceFeatures(s).length])
      );
    },
    { mapId, sources }
  );
}

/** Zoom a map and wait for the by-view re-read (moveend + debounce + read). */
async function zoomTo(page: Page, mapId: string, zoom: number) {
  await page.evaluate(
    ({ mapId, zoom }) => (document.getElementById(mapId) as any).getMap().jumpTo({ zoom }),
    { mapId, zoom }
  );
  await page.waitForTimeout(1200);
}

test("files over the whole-file feature limit: refused in plain words, or read by view — never decoded whole", async ({
  page,
}) => {
  const errors = await guard(page);
  await OPEN(page, "whole", "auto");

  // Can't be read in parts: a notice with the count and the fix, the map still works.
  const notice = page.locator("#whole .ml-map-notice");
  await expect(notice).toContainText("districts.parquet");
  await expect(notice).toContainText("has 48 features, too large to load whole in a browser");
  await expect(notice).toContainText("points-noindex.fgb");
  await expect(notice).toContainText("has 400 features, too large to load whole in a browser");
  await expect(notice).toContainText("load: viewport");
  await expect(notice).toContainText("PMTiles");
  expect(await counts(page, "whole", ["districts", "wells"])).toEqual({ districts: 0, wells: 0 });

  // Can be read in parts: read by view, only what's in view.
  await expect
    .poll(async () => {
      const c = await counts(page, "auto", ["gpq", "fgb"]);
      return c.gpq > 0 && c.gpq < 400 && c.fgb > 0 && c.fgb < 400;
    }, { timeout: 30_000 })
    .toBe(true);
  // The author is told (an author hint: the page is served locally), nothing failed.
  const note = page.locator("#auto .ml-map-notice");
  await expect(note).toContainText("Notes for this map's author");
  await expect(note).toContainText("points.parquet (400 features) is too large to load whole; reading only the part in view");
  await expect(note).toContainText("points.fgb (400 features) is too large to load whole; reading only the part in view");
  // The map still answers.
  expect(await page.evaluate(() => (document.getElementById("auto") as any).getMap().getZoom())).toBe(12);
  await page.screenshot({ path: "e2e/results/large-files-whole.png" });
  expect(errors).toEqual([]);
});

test("an author's maxFeatures raises the whole-file limit: the same file loads whole (M3)", async ({ page }) => {
  const errors = await guard(page);
  await OPEN(page, "raised");
  // Distinct points (a tiled GeoJSON source can return a point once per tile).
  const distinct = () =>
    page.evaluate(() => {
      const map = (document.getElementById("raised") as any).getMap();
      return new Set(map.querySourceFeatures("gpq").map((f: any) => JSON.stringify(f.geometry.coordinates))).size;
    });
  await expect.poll(distinct, { timeout: 30_000 }).toBe(400);
  await expect(page.locator("#raised .ml-map-zoom-in")).toHaveCount(0);
  await expect(page.locator("#raised .ml-map-notice")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("load: viewport stops at maxFeatures: zoomed out, nothing is read and the reader is asked to zoom in", async ({
  page,
}) => {
  const errors = await guard(page);
  const bytes = recordBytes(page);
  await OPEN(page, "budget");
  const line = page.locator("#budget .ml-map-zoom-in");

  // Close in: the points in view draw (fewer than the budget).
  await expect
    .poll(async () => {
      const c = await counts(page, "budget", ["gpq", "fgb"]);
      return c.gpq > 0 && c.fgb > 0 && c.gpq <= 60 && c.fgb <= 60;
    }, { timeout: 30_000 })
    .toBe(true);
  await expect(line).toHaveCount(0);

  // Zoomed out to where the view holds every point (400 > 60): no read.
  await page.waitForTimeout(500);
  const before = bytes.reduce((sum, r) => sum + r.bytes, 0);
  const requests = bytes.length;
  await zoomTo(page, "budget", 10);
  await expect(line).toBeVisible();
  await expect(line).toHaveText("Too many features to show here — zoom in to see them.");
  expect(await counts(page, "budget", ["gpq", "fgb"])).toEqual({ gpq: 0, fgb: 0 });
  // Panning around out there reads nothing either.
  for (const center of [[10.15, 42.1], [10.3, 42.2]]) {
    await page.evaluate((center) => (document.getElementById("budget") as any).getMap().jumpTo({ center }), center);
    await page.waitForTimeout(700);
  }
  expect(bytes.length, JSON.stringify(bytes.slice(requests))).toBe(requests);
  expect(bytes.reduce((sum, r) => sum + r.bytes, 0)).toBe(before);
  await page.screenshot({ path: "e2e/results/large-files-budget.png" });

  // Back in: read again, and the line goes.
  await page.evaluate(() => (document.getElementById("budget") as any).getMap().jumpTo({ center: [10.1, 42.08], zoom: 13 }));
  await expect
    .poll(async () => {
      const c = await counts(page, "budget", ["gpq", "fgb"]);
      return c.gpq > 0 && c.fgb > 0;
    }, { timeout: 30_000 })
    .toBe(true);
  await expect(line).toHaveCount(0);

  // The author hint (the page is served locally: the author is developing).
  await expect(page.locator("#budget .ml-map-notice")).toContainText("over maxFeatures (60)");
  expect(errors).toEqual([]);
});
