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
