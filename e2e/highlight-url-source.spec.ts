/**
 * `hover.highlight` on GeoJSON loaded by `url:` (ml-aot.142) — browser
 * verification, which is also the demo
 * (examples/verification/25-highlight-url-source.html).
 *
 * @remarks
 * Feature-state is addressed by feature id. The library turned on
 * `generateId` for a highlighted layer's inline `data:` only; a file loaded by
 * `url:` — a student's GeoJSON in `public/`, the most common setup — logged
 * "needs feature ids" and never lit. Both ways a document loads such a file
 * are driven here: the layer's own source, and a named `sources:` entry
 * (added before any layer, so the renderer decides up front).
 */
import { test, expect, type Page } from "@playwright/test";
import { PNG } from "pngjs";

const PAGE = "/examples/verification/25-highlight-url-source.html";

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

/** Wait until the feature under a map's centre is hit-testable. */
async function waitForFeatureAtCentre(page: Page, mapId: string) {
  await page.waitForFunction(
    (mapId) => {
      const map = (document.getElementById(mapId) as any)?.getMap?.();
      if (!map?.getLayer?.("quakes")) return false;
      const pt = map.project(map.getCenter());
      return map.queryRenderedFeatures(pt, { layers: ["quakes"] }).length > 0;
    },
    mapId,
    { timeout: 30_000 }
  );
}

/** The centre pixel of one map's canvas (decoded screenshot; see phase1). */
async function centrePixel(page: Page, mapId: string): Promise<[number, number, number]> {
  const shot = await page.locator(`#${mapId} canvas.maplibregl-canvas`).screenshot();
  const png = PNG.sync.read(shot);
  const i = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
}

/** The hover feature-state of the feature under a map's centre. */
async function hoverStateAtCentre(page: Page, mapId: string) {
  return page.evaluate((mapId) => {
    const map = (document.getElementById(mapId) as any).getMap();
    const pt = map.project(map.getCenter());
    const f = map.queryRenderedFeatures(pt, { layers: ["quakes"] })[0];
    if (!f) return { id: null, state: null };
    return { id: f.id ?? null, state: map.getFeatureState({ source: f.source, id: f.id }) };
  }, mapId);
}

test("hovering a feature from a url: file without ids highlights it", async ({ page }) => {
  const seen = await guard(page);
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await page.evaluate(() =>
    Promise.all(Array.from(document.querySelectorAll("ml-map")).map((m: any) => m.mapReady()))
  );

  for (const mapId of ["layer-source", "named-source"]) {
    await waitForFeatureAtCentre(page, mapId);
    const box = (await page.locator(`#${mapId} canvas.maplibregl-canvas`).boundingBox())!;

    // Park the pointer off the feature to sample the authored colour.
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.waitForTimeout(600);
    const before = await centrePixel(page, mapId);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect
      .poll(async () => (await hoverStateAtCentre(page, mapId)).state, {
        timeout: 10_000,
        message: `${mapId}: hover.highlight set no feature-state`,
      })
      .toMatchObject({ hover: true });
    // The ids came from the library: the file has none.
    expect((await hoverStateAtCentre(page, mapId)).id, mapId).not.toBeNull();
    await page.waitForTimeout(600);
    const after = await centrePixel(page, mapId);

    // On screen: authored red (#e63946) becomes the highlight gold (#ffd700).
    expect(before[0], `${mapId} before ${before}`).toBeGreaterThan(150);
    expect(before[1], `${mapId} before ${before}`).toBeLessThan(120);
    expect(after[0], `${mapId} after ${after}`).toBeGreaterThan(150);
    expect(after[1], `${mapId} after ${after}`).toBeGreaterThan(150);
  }

  // The warning that used to be the only outcome is gone.
  expect(seen.warnings.filter((w) => w.includes("needs feature ids"))).toEqual([]);
  expect(seen.errors, seen.errors.join("\n")).toEqual([]);
});
