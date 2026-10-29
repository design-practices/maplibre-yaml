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

test("fitTo on a file too dense at its minzoom opens where its view is read: features, no zoom-in line (PR #206 verification)", async ({
  page,
}) => {
  const errors = await guard(page);
  await OPEN(page, "dense");
  await expect.poll(() => count(page, "dense", "gpq"), { timeout: 30_000 }).toBeGreaterThan(0);
  expect(await count(page, "dense", "gpq")).toBeLessThanOrEqual(60);
  expect(await zoomOf(page, "dense")).toBeGreaterThan(8);
  await expect(page.locator("#dense .ml-map-zoom-in")).toHaveCount(0);
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
  // Row groups of 100 are small: the fix is the packing, a Hilbert sort.
  await expect(notice).toContainText("Its row groups are already small, but loosely packed");
  await expect(notice).toContainText("gpio sort hilbert points-rg100.parquet points-rg100-hilbert.parquet");
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

/** The overview levels (the `level` column) and lots a map's `lots` source holds now. */
function levelsOf(page: Page, mapId: string) {
  return page.evaluate((mapId) => {
    const map = (document.getElementById(mapId) as any).getMap();
    const features = (map.getSource("lots") as any)?._data?.features ?? map.querySourceFeatures("lots");
    return {
      n: features.length as number,
      levels: [...new Set(features.map((f: any) => f.properties.level))].sort() as number[],
    };
  }, mapId);
}

/**
 * A drawn lot near a map's centre: the page point at the middle of its box
 * (relative to the canvas), its id and level.
 */
function lotNearCentre(page: Page, mapId: string) {
  return page.evaluate((mapId) => {
    const map = (document.getElementById(mapId) as any).getMap();
    const c = map.project(map.getCenter());
    let best: { x: number; y: number; id: unknown; level: unknown; d: number } | null = null;
    for (const f of map.queryRenderedFeatures({ layers: ["lots"] })) {
      const ring = f.geometry.coordinates[0] as [number, number][];
      const xs = ring.map((p) => p[0]);
      const ys = ring.map((p) => p[1]);
      const p = map.project([(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]);
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (!best || d < best.d) best = { x: p.x, y: p.y, id: f.id, level: f.properties.level, d };
    }
    return best;
  }, mapId);
}

/** The lot drawn at a canvas point and its hover feature-state. */
function hoverAt(page: Page, mapId: string, point: { x: number; y: number }) {
  return page.evaluate(
    ({ mapId, point }) => {
      const map = (document.getElementById(mapId) as any).getMap();
      const f = map.queryRenderedFeatures([point.x, point.y], { layers: ["lots"] })[0];
      if (!f) return { id: null, level: null, hover: null };
      return { id: f.id ?? null, level: f.properties.level, hover: map.getFeatureState({ source: "lots", id: f.id }).hover ?? null };
    },
    { mapId, point }
  );
}

test("an overview GeoParquet read by view draws the level for the zoom: 10, 12, then the full detail at 14 (0.10 U2, AE1)", async ({
  page,
}) => {
  const errors = await guard(page);
  await OPEN(page, "levels");
  const jump = (zoom: number) =>
    page.evaluate((zoom) => (document.getElementById("levels") as any).getMap().jumpTo({ zoom }), zoom);
  // Level index 0 is zoom 10's, 2 zoom 12's, 4 the full-detail (canonical) one at zoom 14.
  await expect.poll(async () => (await levelsOf(page, "levels")).levels, { timeout: 30_000 }).toEqual([0]);
  await jump(12.6);
  await expect.poll(async () => (await levelsOf(page, "levels")).levels, { timeout: 30_000 }).toEqual([2]);
  await jump(14);
  await expect.poll(async () => (await levelsOf(page, "levels")).levels, { timeout: 30_000 }).toEqual([4]);
  expect((await levelsOf(page, "levels")).n).toBeGreaterThan(100);
  await expect(page.locator("#levels .ml-map-zoom-in")).toHaveCount(0);
  await page.locator("#levels").screenshot({ path: "e2e/results/large-data-levels.png" });
  expect(errors).toEqual([]);
});

test("overviews: false reads only the full-detail level: over budget at zoom 10, the reader is asked to zoom in (AE2)", async ({
  page,
}) => {
  const errors = await guard(page);
  await OPEN(page, "levels-off");
  const line = page.locator("#levels-off .ml-map-zoom-in");
  await expect(line).toBeVisible({ timeout: 30_000 });
  expect(await count(page, "levels-off", "lots")).toBe(0);
  await page.evaluate(() => (document.getElementById("levels-off") as any).getMap().jumpTo({ zoom: 15 }));
  await expect.poll(async () => (await levelsOf(page, "levels-off")).levels, { timeout: 30_000 }).toEqual([4]);
  await expect(line).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("hover with promoteId lights a lot at a coarse level and again after a level switch, which is no document update (AE8)", async ({
  page,
}) => {
  const errors = await guard(page);
  await OPEN(page, "levels");
  await page.evaluate(() => {
    const el = document.getElementById("levels")!;
    (window as any).__updates = 0;
    el.addEventListener("ml-map:update-applied", () => ((window as any).__updates += 1));
  });
  const map = page.locator("#levels");
  await map.scrollIntoViewIfNeeded();
  const jump = (zoom: number) =>
    page.evaluate((zoom) => (document.getElementById("levels") as any).getMap().jumpTo({ zoom }), zoom);
  await jump(12.2);
  await expect.poll(async () => (await levelsOf(page, "levels")).levels, { timeout: 30_000 }).toEqual([2]);
  const box = (await page.locator("#levels canvas.maplibregl-canvas").boundingBox())!;
  /** Hover the drawn lot nearest the centre; returns where it is. */
  const hoverLot = async (level: number) => {
    await expect.poll(async () => (await lotNearCentre(page, "levels"))?.level, { timeout: 10_000 }).toBe(level);
    const lot = (await lotNearCentre(page, "levels"))!;
    await page.mouse.move(box.x + lot.x - 2, box.y + lot.y);
    await page.mouse.move(box.x + lot.x, box.y + lot.y);
    await expect.poll(() => hoverAt(page, "levels", lot), { timeout: 10_000 }).toMatchObject({ level, hover: true });
    return lot;
  };
  const coarse = await hoverLot(2);
  expect(coarse.id).not.toBeNull();

  // Zoom in past the zoom-14 boundary with the pointer still: the full-detail level, the old lit state gone.
  await jump(14.3);
  await expect.poll(async () => (await levelsOf(page, "levels")).levels, { timeout: 30_000 }).toEqual([4]);
  const stale = await page.evaluate(
    (id) => (document.getElementById("levels") as any).getMap().getFeatureState({ source: "lots", id }).hover ?? null,
    coarse.id
  );
  expect(stale).not.toBe(true);
  await hoverLot(4);
  await map.screenshot({ path: "e2e/results/large-data-levels-hover.png" });
  expect(await page.evaluate(() => (window as any).__updates)).toBe(0);
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
