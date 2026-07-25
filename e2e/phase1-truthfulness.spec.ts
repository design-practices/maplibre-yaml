/**
 * Phase 1 (schema truthfulness) — browser verification.
 *
 * @remarks
 * Every unit in this release fixes a field that validated and then did nothing.
 * The unit suites assert against a mocked map, so they prove we *called*
 * MapLibre with a given object; they cannot prove a user sees anything. These
 * tests drive a real map and assert on observable state — an attribution
 * element in the DOM, a camera that moved, a colour that changed — so a fix
 * that is inert in a browser fails here.
 */
import { test, expect, type Page } from "@playwright/test";
import { PNG } from "pngjs";

const FIXTURES = "/examples/verification";

/** Load a fixture and wait for MapLibre to finish its first render. */
async function openMap(page: Page, file: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });

  // Hermeticity is enforced, not just intended. This suite is a required CI
  // check, so a fixture that quietly reaches a CDN would make the build
  // dependent on someone else's uptime. Any off-origin request fails the test
  // rather than silently working on a developer machine with a warm cache.
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || url.startsWith("data:")) {
      return route.continue();
    }
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });

  // Not `networkidle`: a tiled layer keeps fetching as the map renders, so the
  // network never goes quiet and the wait times out. Wait on the map itself.
  await page.goto(`${FIXTURES}/${file}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas.maplibregl-canvas", { timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector("ml-map") as any;
      return !!el?.getMap?.()?.isStyleLoaded?.();
    },
    undefined,
    { timeout: 30_000 }
  );
  return errors;
}

/**
 * Wait until a layer's features are actually hit-testable.
 *
 * @remarks
 * Layers are added asynchronously after the map's `load`, and interaction
 * listeners attach after that. A fixed sleep races it — under software
 * rendering the margin moves — so wait on the real readiness signal instead.
 */
async function waitForInteractiveLayer(page: Page, layerId: string) {
  await page.waitForFunction(
    (id) => {
      const el = document.querySelector("ml-map") as any;
      const map = el?.getMap?.();
      if (!map || !map.getLayer(id)) return false;
      const pt = map.project(map.getCenter());
      return map.queryRenderedFeatures(pt, { layers: [id] }).length > 0;
    },
    layerId,
    { timeout: 30_000 }
  );
}

/** Centre pixel of a screenshot, where the fixtures place their feature. */
async function centrePixel(page: Page): Promise<[number, number, number]> {
  const canvas = page.locator("canvas.maplibregl-canvas");
  const shot = await canvas.screenshot();
  // Decoding the screenshot rather than gl.readPixels: without
  // preserveDrawingBuffer the WebGL back buffer reads back black, so
  // readPixels reports [0,0,0] whether or not the colour changed.
  const png = PNG.sync.read(shot);
  const x = Math.floor(png.width / 2);
  const y = Math.floor(png.height / 2);
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}

/** Read the live map instance the web component holds. */
async function mapState(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector("ml-map") as any;
    const map = el?.getMap?.() ?? el?.map;
    return map ? { zoom: map.getZoom(), center: map.getCenter() } : null;
  });
}

test.describe("U3 — controls.attribution", () => {
  test("renders exactly one attribution control", async ({ page }) => {
    const errors = await openMap(page, "05-u3-attribution.html");

    const attributions = page.locator(".maplibregl-ctrl-attrib");

    // The whole point of the unit: one, not two. A missing
    // `attributionControl: false` at construction shows both.
    await expect(attributions).toHaveCount(1);
    await expect(attributions.first()).toContainText("U3 ATTRIBUTION OK");

    // It must be in the configured corner, not wherever MapLibre defaults to.
    const corner = page.locator(
      ".maplibregl-ctrl-bottom-right .maplibregl-ctrl-attrib"
    );
    await expect(corner).toHaveCount(1);

    expect(errors).toEqual([]);
    await page.screenshot({ path: "e2e/screenshots/u3-attribution.png" });
  });

  test("a map that configures no attribution still shows MapLibre's own", async ({
    page,
  }) => {
    // Regression: an earlier form of the U3 guard always set
    // `attributionControl`, so an unconfigured map got `undefined`, which
    // MapLibre merges over its default — leaving every map with NO attribution.
    // That is a licensing failure, and the unit test could not see it because
    // it asserted the option value rather than the rendered outcome.
    const errors = await openMap(page, "02-controls-legend.html");

    const attributions = page.locator(".maplibregl-ctrl-attrib");
    await expect(attributions).toHaveCount(1);
    await expect(attributions.first()).not.toBeEmpty();

    expect(errors).toEqual([]);
  });
});

test.describe("U4 — click.flyTo", () => {
  test("clicking a feature moves the camera", async ({ page }) => {
    const errors = await openMap(page, "06-u4-click-flyto.html");
    await waitForInteractiveLayer(page, "targets");

    const before = await mapState(page);
    expect(before?.zoom).toBeCloseTo(10, 0);

    // Click the feature, which the fixture places at the map centre.
    const canvas = page.locator("canvas.maplibregl-canvas");
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1500); // let the 300ms flight finish

    const after = await mapState(page);

    // The behavioural claim: the camera actually moved to the configured zoom.
    expect(after!.zoom).toBeGreaterThan(before!.zoom + 1);
    expect(after!.zoom).toBeCloseTo(14, 0);

    expect(errors).toEqual([]);
    await page.screenshot({ path: "e2e/screenshots/u4-flyto-after.png" });
  });
});

test.describe("U5 — hover.highlight", () => {
  test("hovering a feature changes its rendered colour", async ({ page }) => {
    const errors = await openMap(page, "07-u5-hover-highlight.html");
    await waitForInteractiveLayer(page, "hoverable");

    const canvas = page.locator("canvas.maplibregl-canvas");
    const box = (await canvas.boundingBox())!;

    // Park the pointer off the feature so we sample the authored colour.
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.waitForTimeout(800);
    const unhovered = await centrePixel(page);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1200);
    const hovered = await centrePixel(page);

    // The end-to-end claim: the feature-state write and the paint expression
    // meet on screen. Authored #e63946 (red) becomes the highlight #ffd700.
    expect(unhovered[0]).toBeGreaterThan(150); // red channel high
    expect(unhovered[1]).toBeLessThan(120); // green low  -> red
    expect(hovered[0]).toBeGreaterThan(150);
    expect(hovered[1]).toBeGreaterThan(150); // green now high -> gold
    expect(hovered).not.toEqual(unhovered);

    expect(errors).toEqual([]);
    await page.screenshot({ path: "e2e/screenshots/u5-highlight-hovered.png" });
  });
});

test.describe("U6 — raster-dem hillshade", () => {
  test("adds a hillshade layer from a raster-dem source", async ({ page }) => {
    const errors = await openMap(page, "08-u6-hillshade.html");

    const layer = await page.evaluate(() => {
      const el = document.querySelector("ml-map") as any;
      const map = el?.getMap?.() ?? el?.map;
      if (!map) return null;
      const src: any = map.getSource("hills-source");
      return {
        hasLayer: !!map.getLayer("hills"),
        sourceType: src?.type ?? null,
        encoding: src?.encoding ?? null,
      };
    });

    // Previously impossible to express: hillshade had no valid source type.
    expect(layer?.hasLayer).toBe(true);
    expect(layer?.sourceType).toBe("raster-dem");

    expect(errors).toEqual([]);
    await page.screenshot({ path: "e2e/screenshots/u6-hillshade.png" });
  });
});
