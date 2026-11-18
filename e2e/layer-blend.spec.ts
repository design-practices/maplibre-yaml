/**
 * Layer blending (`fill-layer-blend`, style-spec 26.8 / maplibre-gl 6.18) —
 * browser verification, which is also the demo
 * (examples/verification/layer-blend.html).
 *
 * @remarks
 * The unit suites prove the key passes through the schema and the renderer;
 * only a real map proves the pixel: where the cyan `multiply` square overlaps
 * the yellow one, multiply gives green, normal compositing gives cyan. Two
 * tests, one per side of the floor, so every matrix leg runs one of them:
 *
 *  - maplibre-gl >= 6.18: the overlap is green, the paint property is on the
 *    layer, no console noise;
 *  - older: the renderer dropped the key (the overlap is plain cyan), the
 *    layer is still on the map (MapLibre would have refused it with the key
 *    kept), and exactly one console notice names the key and the floor.
 *
 * The vendor version comes from VERIFY_MAPLIBRE_DIR (another install served
 * locally, see e2e/server.mjs) or the repo's node_modules (the CI matrix
 * overrides it).
 */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const PAGE = "/examples/verification/layer-blend.html";
const MAPLIBRE_DIR = process.env.VERIFY_MAPLIBRE_DIR ?? join(process.cwd(), "node_modules/maplibre-gl");
const VENDOR_VERSION: string = JSON.parse(readFileSync(join(MAPLIBRE_DIR, "package.json"), "utf8")).version;
const [VENDOR_MAJOR, VENDOR_MINOR] = VENDOR_VERSION.split(".").map(Number) as [number, number];
const BLENDS = VENDOR_MAJOR > 6 || (VENDOR_MAJOR === 6 && VENDOR_MINOR >= 18);

type RGB = [number, number, number];
const YELLOW: RGB = [255, 204, 0];
const CYAN: RGB = [0, 204, 255];
/** multiply(#00ccff, #ffcc00): (0·255, 204·204, 255·0) / 255. */
const MULTIPLIED: RGB = [0, 163, 0];

test.use({ viewport: { width: 800, height: 700 } });

/** Fail the test on any page error or off-origin request (hermeticity); collect warnings. */
async function guard(page: Page): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
    if (m.type() === "warning") warnings.push(m.text());
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || /^(data|blob):/.test(url)) {
      return route.continue();
    }
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return { errors, warnings };
}

/** Open the page and wait until both squares are drawn. */
async function open(page: Page): Promise<void> {
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => {
      const map = (document.getElementById("map") as any)?.getMap?.();
      if (!map || !map.isStyleLoaded?.() || !map.loaded?.()) return false;
      return ["under", "over"].every(
        (id) => Boolean(map.getLayer?.(id)) && (map.queryRenderedFeatures(undefined, { layers: [id] }) ?? []).length > 0
      );
    },
    undefined,
    { timeout: 60_000 }
  );
  // One more frame so the blend pass is on the canvas before the screenshot.
  await page.evaluate(
    () => new Promise<void>((done) => (document.getElementById("map") as any).getMap().once("idle", () => done()))
  );
}

/**
 * The layer's `fill-layer-blend` paint value, or undefined. A runtime older
 * than 6.18 throws from `getPaintProperty` for a name it does not know.
 */
async function blendOf(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    try {
      return (document.getElementById("map") as any).getMap().getPaintProperty("over", "fill-layer-blend") ?? undefined;
    } catch {
      return undefined;
    }
  });
}

/** Canvas pixels at map coordinates. */
async function sample(page: Page, points: Array<[number, number]>): Promise<RGB[]> {
  const positions: Array<[number, number]> = await page.evaluate((pts) => {
    const map = (document.getElementById("map") as any).getMap();
    return pts.map((p: [number, number]) => {
      const xy = map.project(p);
      return [xy.x, xy.y];
    });
  }, points);
  const canvas = page.locator("#map canvas.maplibregl-canvas");
  const png = PNG.sync.read(await canvas.screenshot());
  const box = (await canvas.boundingBox())!;
  const scale = png.width / box.width;
  return positions.map(([x, y]) => {
    const i = (Math.round(y * scale) * png.width + Math.round(x * scale)) * 4;
    return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
  });
}

function expectColor(actual: RGB, wanted: RGB, what: string, tolerance = 12): void {
  for (let c = 0; c < 3; c++) {
    expect(Math.abs(actual[c]! - wanted[c]!), `${what}: got rgb(${actual.join(",")}), wanted rgb(${wanted.join(",")})`).toBeLessThanOrEqual(tolerance);
  }
}

test.describe(`fill-layer-blend on maplibre-gl ${VENDOR_VERSION}`, () => {
  test("multiply blends the top square with the one under it (6.18+)", async ({ page }) => {
    test.skip(!BLENDS, "fill-layer-blend needs maplibre-gl >= 6.18");
    const { errors, warnings } = await guard(page);
    await open(page);

    expect(await blendOf(page)).toBe("multiply");

    const [underOnly, overlap, overOnly] = await sample(page, [[-5, -5], [5, 5], [15, 15]]);
    expectColor(underOnly!, YELLOW, "yellow square alone");
    expectColor(overlap!, MULTIPLIED, "overlap, multiplied");
    // Over the basemap (#cfe8c9) multiply gives (0, 185, 201): not plain cyan either.
    expectColor(overOnly!, [0, 185, 201], "cyan square over the basemap, multiplied");

    expect(warnings.filter((w) => /layer-blend/.test(w))).toEqual([]);
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("an older runtime draws the layer without the key and says why once (< 6.18)", async ({ page }) => {
    test.skip(BLENDS, "this leg's maplibre-gl knows fill-layer-blend");
    const { errors, warnings } = await guard(page);
    await open(page);

    // The layer is on the map — MapLibre would have refused it had the
    // unknown property reached it — and draws with normal compositing.
    expect(await blendOf(page)).toBeUndefined();
    const [underOnly, overlap] = await sample(page, [[-5, -5], [5, 5]]);
    expectColor(underOnly!, YELLOW, "yellow square alone");
    expectColor(overlap!, CYAN, "overlap, normal compositing");

    const notices = warnings.filter((w) => /fill-layer-blend/.test(w));
    expect(notices, `notices:\n${warnings.join("\n")}`).toHaveLength(1);
    expect(notices[0]).toContain("6.18.0");
    expect(notices[0]).toContain(VENDOR_VERSION);
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});
