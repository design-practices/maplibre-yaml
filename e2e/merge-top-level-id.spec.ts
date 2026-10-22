/**
 * Live `merge` refreshes keep their features (ml-aot.141) — browser
 * verification, which is also the demo
 * (examples/verification/24-merge-top-level-id.html).
 *
 * @remarks
 * The gallery's "Update a feature in realtime" page polled the USGS feed with
 * `updateStrategy: merge, updateKey: id`. USGS keeps each feature's id at the
 * top level (`feature.id`), not in `properties`, and merge only looked in
 * `properties`: the first poll dropped every feature, and 20 earthquakes
 * became 0. The unit suite proves the merge rule; this proves the user-visible
 * claim on a real map, across real polls:
 *
 * - `#by-id`: a USGS-shaped feed whose second response changes (one quake's
 *   magnitude, one new quake, one no longer listed). After the poll the map
 *   holds all six: updated in place, added, and kept.
 * - `#keyless`: features with no key at all are kept, not dropped, and the
 *   map's author notes name the source and the key.
 */
import { test, expect, type Page } from "@playwright/test";
import { join } from "node:path";

const PAGE = "/examples/verification/24-merge-top-level-id.html";
const FEED = "**/examples/verification/data/usgs-quakes-poll.geojson";
const SECOND = join(__dirname, "..", "examples/verification/data/usgs-quakes-poll-2.geojson");

/** Fail the test on any page error or off-origin request (hermeticity). */
async function guard(page: Page): Promise<{ errors: string[]; warnings: string[] }> {
  const seen = { errors: [] as string[], warnings: [] as string[] };
  page.on("pageerror", (e) => seen.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") seen.errors.push(`console: ${m.text()}`);
    if (m.type() === "warning") seen.warnings.push(m.text());
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || url.startsWith("data:")) {
      return route.continue();
    }
    seen.errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return seen;
}

/** The GeoJSON a map's `quakes` source holds right now. */
async function sourceFeatures(page: Page, mapId: string) {
  return page.evaluate(async (mapId) => {
    const map = (document.getElementById(mapId) as any)?.getMap?.();
    const source = map?.getSource?.("quakes");
    if (!source?.getData) return null;
    const data = await source.getData();
    return (data?.features ?? []).map((f: any) => ({
      id: f.id ?? null,
      mag: f.properties?.mag ?? null,
    }));
  }, mapId);
}

test("merge matches USGS top-level ids across polls and keeps keyless features", async ({
  page,
}) => {
  const seen = await guard(page);

  // The feed's first answer is the file; every later poll answers with the
  // changed file — what a live feed does between polls.
  let requests = 0;
  await page.route(FEED, (route) => {
    requests += 1;
    return requests === 1
      ? route.continue()
      : route.fulfill({ path: SECOND, contentType: "application/geo+json" });
  });

  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await page.evaluate(() =>
    Promise.all(Array.from(document.querySelectorAll("ml-map")).map((m: any) => m.mapReady()))
  );

  // First load: the five quakes in the file.
  await expect.poll(async () => (await sourceFeatures(page, "by-id"))?.length, { timeout: 30_000 }).toBe(5);

  // After at least one poll: ci1 (no longer in the feed) kept, ci2 updated
  // in place (3.4 -> 4.7), ci6 added. Before the fix: 0 features.
  await expect
    .poll(async () => requests, { timeout: 30_000, message: "the source never polled" })
    .toBeGreaterThanOrEqual(3);
  const merged = await sourceFeatures(page, "by-id");
  expect(merged).toEqual([
    { id: "ci1", mag: 2.1 },
    { id: "ci2", mag: 4.7 },
    { id: "ci3", mag: 1.8 },
    { id: "ci4", mag: 2.6 },
    { id: "ci5", mag: 4 },
    { id: "ci6", mag: 3.1 },
  ]);

  // And they draw: the dots are on the map, not only in the source.
  await page.waitForFunction(
    () => {
      const map = (document.getElementById("by-id") as any)?.getMap?.();
      return (map?.queryRenderedFeatures?.(undefined, { layers: ["quakes-points"] }) ?? []).length >= 6;
    },
    undefined,
    { timeout: 20_000 }
  );

  // Keyless: all eight sample quakes survive repeated polls (not 0, and not
  // a growing pile of copies).
  await page.waitForTimeout(2_500);
  expect(await sourceFeatures(page, "keyless")).toHaveLength(8);

  // The author is told once, on the page (developing) and in the console,
  // naming the source, the key and the properties the data does have.
  const notice = page.locator("#keyless .ml-map-notice");
  await expect(notice).toContainText("quakes", { timeout: 10_000 });
  await expect(notice).toContainText("can't match them");
  await expect(notice).toContainText("mag");
  const hints = seen.warnings.filter((w) => w.includes("can't match them"));
  expect(hints, hints.join("\n")).toHaveLength(1);
  expect(hints[0]).toContain('"id"');
  // The map whose features all have ids says nothing.
  await expect(page.locator("#by-id .ml-map-notice")).toHaveCount(0);

  expect(seen.errors, seen.errors.join("\n")).toEqual([]);
});
