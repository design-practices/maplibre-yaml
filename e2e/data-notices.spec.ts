/**
 * Data a student brings, named for what it is (ml-aot.47, ml-aot.51) —
 * browser verification and demo
 * (examples/verification/student-errors/data-kinds.html).
 *
 * - a .geojson file holding ONE Feature draws (it is GeoJSON; MapLibre
 *   accepts it);
 * - a CSV file gets "CSV files aren't supported — convert it to GeoJSON",
 *   not "it isn't JSON — a wrong path…";
 * - a fitTo.source typo is on the page, with the did-you-mean.
 */
import { test, expect } from "@playwright/test";

test("single-Feature data draws; CSV and a fitTo typo are explained on the map", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || /^(data|blob):/.test(url)) return route.continue();
    errors.push(`external request: ${url}`);
    return route.abort();
  });
  await page.goto("/examples/verification/student-errors/data-kinds.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => (document.getElementById("map") as any).mapReady());
  await page.waitForFunction(
    () => (document.getElementById("map") as any).getMap().querySourceFeatures("drawn").length > 0,
    undefined,
    { timeout: 30_000 }
  );
  const notice = page.locator("#map .ml-map-notice");
  await expect(notice).toContainText("CSV files aren't supported — convert it to GeoJSON (e.g. geojson.io or QGIS)");
  await expect(notice).toContainText('fitTo.source "place" names no source in sources: — did you mean "places"?');
  const text = (await notice.innerText()).replace(/\s+/g, " ");
  expect(text).not.toContain("isn't GeoJSON");
  expect(text).not.toContain("isn't JSON");
  await page.screenshot({ path: "e2e/results/data-kinds.png" });
  expect(errors).toEqual([]);
});
