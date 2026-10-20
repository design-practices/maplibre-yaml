/**
 * `fitTo` on a `url:` source builds the map already framed (ml-aot.75) —
 * browser verification and demo
 * (examples/verification/fit-to-framed/map.html, story.html).
 *
 * The document's own camera is the whole world; `fitTo` names a fetched
 * file of three Brooklyn parks. `<ml-map>` fetches the file while the page
 * starts and builds the map with its bounds, so:
 *
 * - with the file slow but inside the wait (600 ms), the FIRST frame is
 *   already on Brooklyn and the camera never moves during load;
 * - with the file slower than the wait (3 s), the map is built at the
 *   world view and fits once when the data lands (the 0.8 behaviour);
 * - either way, the file is requested exactly once;
 * - a story's map (`<ml-scrollytelling>`) gets the same.
 */
import { test, expect, type Page } from "@playwright/test";

const PARKS = "**/fit-to-framed/data/parks.geojson";

/** Brooklyn, around the three parks. */
const near = (camera: { lng: number; lat: number; zoom: number }) =>
  Math.abs(camera.lng - -73.983) < 0.05 && Math.abs(camera.lat - 40.684) < 0.05 && camera.zoom > 10;

/** Delay the parks file by `ms`, and count requests for it. */
async function slowParks(page: Page, ms: number): Promise<{ count: () => number }> {
  let requests = 0;
  await page.route(PARKS, async (route) => {
    requests += 1;
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
  return { count: () => requests };
}

async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

/** The camera now, and what the page recorded of the first frame. */
async function frames(page: Page) {
  return page.evaluate(() => {
    const map = (document.querySelector("ml-map") as any).getMap();
    const c = map.getCenter();
    return {
      first: (window as any).__frames.first as { lng: number; lat: number; zoom: number },
      moves: (window as any).__frames.moves as number,
      fits: (window as any).__frames.fits as number,
      now: { lng: c.lng, lat: c.lat, zoom: map.getZoom() },
    };
  });
}

async function settled(page: Page) {
  await page.evaluate(() => (document.querySelector("ml-map") as any).mapReady());
  await page.waitForFunction(
    () => {
      const map = (document.querySelector("ml-map") as any).getMap();
      return map.querySourceFeatures("parks").length > 0 && !map.isMoving();
    },
    undefined,
    { timeout: 30_000 }
  );
}

test.describe("fitTo on a url: source (ml-aot.75)", () => {
  test("data inside the wait: the first frame is already framed, no jump, one request", async ({ page }) => {
    const errors = await guard(page);
    const parks = await slowParks(page, 600);
    await page.goto("/examples/verification/fit-to-framed/map.html");
    await settled(page);
    const f = await frames(page);
    expect(f.first, "no first frame recorded").not.toBeNull();
    expect(near(f.first), `first frame not on Brooklyn: ${JSON.stringify(f.first)}`).toBe(true);
    // The first frame IS the final camera: nothing moved during load.
    expect(f.moves).toBe(0);
    expect(f.first.zoom).toBeCloseTo(f.now.zoom, 6);
    expect(f.first.lng).toBeCloseTo(f.now.lng, 6);
    expect(f.fits).toBe(1);
    expect(parks.count()).toBe(1);
    await expect(page.locator("#camera")).toContainText("camera moves after the first frame: 0");
    await page.screenshot({ path: "e2e/results/small_fit-to-framed.png" });
    expect(errors).toEqual([]);
  });

  test("data slower than the wait: built at the authored camera, fitted once when it lands, one request", async ({
    page,
  }) => {
    const errors = await guard(page);
    const parks = await slowParks(page, 3000);
    await page.goto("/examples/verification/fit-to-framed/map.html");
    await settled(page);
    const f = await frames(page);
    // The 0.8 behaviour: the world first, then one fit.
    expect(f.first.zoom).toBeLessThan(3);
    expect(near(f.now), `not fitted after the data: ${JSON.stringify(f.now)}`).toBe(true);
    expect(f.moves).toBeGreaterThan(0);
    expect(f.fits).toBe(1);
    // The renderer awaited the prefetch already in flight: no second request.
    expect(parks.count()).toBe(1);
    expect(errors).toEqual([]);
  });

  test("a story's map is framed the same way", async ({ page }) => {
    const errors = await guard(page);
    const parks = await slowParks(page, 600);
    await page.goto("/examples/verification/fit-to-framed/story.html");
    await settled(page);
    const f = await frames(page);
    // (Chapter 1's own camera takes over once the map loads.)
    expect(near(f.first), `first frame not on Brooklyn: ${JSON.stringify(f.first)}`).toBe(true);
    expect(parks.count()).toBe(1);
    await page.screenshot({ path: "e2e/results/small_fit-to-framed-story.png" });
    expect(errors).toEqual([]);
  });
});
