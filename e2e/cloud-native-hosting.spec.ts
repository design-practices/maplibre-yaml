/**
 * Cloud-native files on hosts that bend the range-request rules (0.9) —
 * browser verification, which is also the demo
 * (examples/verification/cloud-native/hosting.html).
 *
 * @remarks
 * GitHub Pages, raw.githubusercontent.com and jsDelivr's Fastly leg answer a
 * suffix range longer than the file with 416 (`Content-Range: bytes *\/<size>`)
 * instead of the whole file, and don't expose `Content-Range` to a page on
 * another site. Both made good small GeoParquet files fail ("didn't load
 * (416)", or "isn't a GeoParquet file"). e2e/server.mjs imitates the two under
 * `/fastly/`; every format is read through it, from the page's own origin and
 * from another one. Runs on every maplibre-gl leg of the CI matrix.
 */
import { test, expect, type Page } from "@playwright/test";

/** Fail on page errors and off-origin requests (hermeticity). */
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

/** Every response under /fastly/: status and the Range sent. */
function recordFastly(page: Page) {
  const seen: { file: string; origin: string; status: number; range: string | undefined; method: string }[] = [];
  page.on("response", (r) => {
    const m = /^(http:\/\/[^/]+)\/fastly\/gallery-assets\/cloud-native\/(.+)$/.exec(r.url());
    if (m) seen.push({ origin: m[1]!, file: m[2]!, status: r.status(), range: r.request().headers()["range"], method: r.request().method() });
  });
  return seen;
}

/** Wait until every source of the map holds what it should: features, outlines, imagery tiles. */
async function waitForEverything(page: Page, id: string) {
  await page.waitForFunction(
    (id) => {
      const map = (document.getElementById(id) as any)?.getMap?.();
      if (!map || !map.loaded()) return false;
      const has = (s: string, options?: object) => map.getSource(s) && map.querySourceFeatures(s, options).length > 0;
      return (
        has("fgb") &&
        has("parquet") &&
        has("fgbpoints") &&
        has("parquetpoints") &&
        has("outlines", { sourceLayer: "districts" }) &&
        map.isSourceLoaded("imagery") &&
        map.areTilesLoaded()
      );
    },
    id,
    { timeout: 60_000 }
  );
}

const counts = (page: Page, id: string) =>
  page.evaluate((id) => {
    const map = (document.getElementById(id) as any).getMap();
    const n = (s: string) => new Set(map.querySourceFeatures(s).map((f: any) => JSON.stringify(f.geometry.coordinates))).size;
    return {
      fgb: n("fgb"),
      parquet: n("parquet"),
      fgbpoints: n("fgbpoints"),
      parquetpoints: n("parquetpoints"),
      notice: document.querySelector(`#${id} .ml-map-notice`)?.textContent ?? null,
    };
  }, id);

test.describe("cloud-native files on GitHub Pages / jsDelivr-like hosts", () => {
  test("same origin: a 416 for an oversized suffix range is a small file, read whole", async ({ page }) => {
    const errors = await guard(page);
    const seen = recordFastly(page);
    await page.goto("/examples/verification/cloud-native/hosting.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => (document.getElementById("same") as any).mapReady());
    await waitForEverything(page, "same");
    const state = await counts(page, "same");
    expect(state.notice).toBeNull();
    expect(state.fgb).toBeGreaterThan(20); // the districts in view
    expect(state.parquet).toBeGreaterThan(20);
    expect(state.fgbpoints).toBeGreaterThan(0);
    expect(state.parquetpoints).toBeGreaterThan(0);
    // The host really answered the GeoParquet suffix read with 416, and the
    // file was then read whole: the condition under test happened.
    const parquet = seen.filter((r) => r.origin.includes("localhost") && r.file === "districts.parquet");
    expect(parquet.map((r) => [r.status, r.range ?? null])).toEqual([
      [416, "bytes=-524288"],
      [200, null],
    ]);
    await page.screenshot({ path: "e2e/results/hosting_same.png" });
    expect(errors).toEqual([]);
  });

  test("another origin: Content-Range hidden as well — every format still reads", async ({ page }) => {
    const errors = await guard(page);
    const seen = recordFastly(page);
    await page.goto("/examples/verification/cloud-native/hosting.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => (document.getElementById("cross") as any).mapReady());
    await waitForEverything(page, "cross");
    const state = await counts(page, "cross");
    expect(state.notice).toBeNull();
    expect(state.fgb).toBeGreaterThan(20); // the districts in view
    expect(state.parquet).toBeGreaterThan(20);
    expect(state.fgbpoints).toBeGreaterThan(0);
    expect(state.parquetpoints).toBeGreaterThan(0);
    // The conditions under test: this page can't read Content-Range there,
    // and the suffix read of a small file is a 416.
    const hidden = await page.evaluate(async () => {
      const url = `http://127.0.0.1:${location.port}/fastly/gallery-assets/cloud-native/points.fgb`;
      const r = await fetch(url, { headers: { Range: "bytes=0-7" } });
      return { status: r.status, contentRange: r.headers.get("content-range") };
    });
    expect(hidden).toEqual({ status: 206, contentRange: null });
    expect(
      seen.some((r) => r.origin.includes("127.0.0.1") && r.file === "points.parquet" && r.status === 416)
    ).toBe(true);
    await page.screenshot({ path: "e2e/results/hosting_cross.png" });
    expect(errors).toEqual([]);
  });
});
