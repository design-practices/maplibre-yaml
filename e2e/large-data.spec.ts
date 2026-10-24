/**
 * Large data, the 0.9.2 review round (PR #206) — browser verification,
 * which is also the demo (examples/verification/cloud-native/large-data.html).
 *
 * @remarks
 * What a reader of a map over a large FlatGeobuf or GeoParquet file sees:
 * never a blank map without a word. Runs on every maplibre-gl leg of the CI
 * matrix.
 */
import { test, expect, type Page } from "@playwright/test";

const PAGE = "/examples/verification/cloud-native/large-data.html";

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

const OPEN = async (page: Page, ...ids: string[]) => {
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  for (const id of ids) await page.evaluate((id) => (document.getElementById(id) as any).mapReady(), id);
};

/** How many features a source of a map holds now. */
function count(page: Page, mapId: string, source: string) {
  return page.evaluate(
    ({ mapId, source }) => {
      const map = (document.getElementById(mapId) as any).getMap();
      return (map.getSource(source) as any)?._data?.features?.length ?? map.querySourceFeatures(source).length;
    },
    { mapId, source }
  );
}

const zoomOf = (page: Page, mapId: string) =>
  page.evaluate((mapId) => (document.getElementById(mapId) as any).getMap().getZoom() as number, mapId);

test("fitTo on a file read by view opens at its minzoom, with features drawn (M1)", async ({ page }) => {
  const errors = await guard(page);
  await OPEN(page, "fit");
  await expect.poll(() => count(page, "fit", "gpq"), { timeout: 30_000 }).toBeGreaterThan(0);
  expect(await zoomOf(page, "fit")).toBeCloseTo(13, 5);
  await expect(page.locator("#fit .ml-map-zoom-in")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("below minzoom the reader is asked to zoom in; zoomed in, the features draw and the line goes (M1)", async ({ page }) => {
  const errors = await guard(page);
  await OPEN(page, "below");
  const line = page.locator("#below .ml-map-zoom-in");
  await expect(line).toBeVisible();
  await expect(line).toHaveText("Too many features to show here — zoom in to see them.");
  expect(await count(page, "below", "fgb")).toBe(0);
  await page.screenshot({ path: "e2e/results/large-data-below.png" });
  await page.evaluate(() => (document.getElementById("below") as any).getMap().jumpTo({ zoom: 13 }));
  await expect.poll(() => count(page, "below", "fgb"), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(line).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a GeoParquet view whose row groups are too large to decode isn't read, and the author is told why (M2)", async ({
  page,
}) => {
  const errors = await guard(page);
  await OPEN(page, "groups");
  await expect.poll(() => count(page, "groups", "small"), { timeout: 30_000 }).toBeGreaterThan(0);
  expect(await count(page, "groups", "small")).toBeLessThanOrEqual(30);
  await expect(page.locator("#groups .ml-map-zoom-in")).toBeVisible();
  expect(await count(page, "groups", "large")).toBe(0);
  const notice = page.locator("#groups .ml-map-notice");
  await expect(notice).toContainText("points-rg100.parquet has row groups of up to 100 rows");
  await expect(notice).toContainText("ROW_GROUP_SIZE=10000");
  await page.screenshot({ path: "e2e/results/large-data-groups.png" });
  expect(errors).toEqual([]);
});

test("an overview GeoParquet (geo:overviews) draws each feature once, from its full-detail level (ml-cnv.21)", async ({
  page,
}) => {
  const errors = await guard(page);
  await OPEN(page, "overviews");
  const lots = () =>
    page.evaluate(() => {
      const map = (document.getElementById("overviews") as any).getMap();
      const features = map.querySourceFeatures("lots");
      return {
        lots: new Set(features.map((f: any) => f.properties.lot)).size,
        levels: [...new Set(features.map((f: any) => f.properties.level))],
      };
    });
  await expect.poll(async () => (await lots()).lots, { timeout: 30_000 }).toBe(600);
  // Every row drawn comes from the canonical level (4): no coarser copy overlaid.
  expect((await lots()).levels).toEqual([4]);
  await page.screenshot({ path: "e2e/results/large-data-overviews.png" });
  expect(errors).toEqual([]);
});

test("the zoom-in line: hidden by quiet whenever it is set, gone with its source's last layer (ml-cnv.32)", async ({
  page,
}) => {
  const errors = await guard(page);
  await OPEN(page, "below");
  const line = page.locator("#below .ml-map-zoom-in");
  await expect(line).toBeVisible();
  // quiet, set after the line showed, hides it; removed, it shows again.
  await page.evaluate(() => document.getElementById("below")!.setAttribute("quiet", ""));
  await expect(line).toBeHidden();
  await page.evaluate(() => document.getElementById("below")!.removeAttribute("quiet"));
  await expect(line).toBeVisible();
  // The source's last layer removed: nothing of it is drawn, nothing to zoom in for.
  await page.evaluate(() => (document.getElementById("below") as any).removeLayer("fgb"));
  await expect(line).toHaveCount(0);
  // And the source no longer reads on every move.
  const reads: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/points.fgb")) reads.push(r.url());
  });
  await page.evaluate(() => (document.getElementById("below") as any).getMap().jumpTo({ zoom: 13 }));
  await page.waitForTimeout(1000);
  expect(reads).toEqual([]);
  await expect(line).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the zoom-in line follows the page's colour scheme (ml-cnv.32)", async ({ page }) => {
  const errors = await guard(page);
  await OPEN(page, "below", "dark");
  const colours = (id: string) =>
    page.evaluate((id) => {
      const line = document.querySelector(`#${id} .ml-map-zoom-in`)!;
      const style = getComputedStyle(line);
      const lum = (c: string) => {
        const [r, g, b] = c.match(/\d+/g)!.map(Number);
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      return { background: lum(style.backgroundColor), text: lum(style.color) };
    }, id);
  await expect(page.locator("#dark .ml-map-zoom-in")).toBeVisible();
  const light = await colours("below");
  const dark = await colours("dark");
  expect(light.background).toBeGreaterThan(light.text);
  expect(dark.background).toBeLessThan(dark.text);
  await page.locator("#dark").screenshot({ path: "e2e/results/large-data-dark.png" });
  expect(errors).toEqual([]);
});
