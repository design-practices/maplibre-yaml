/**
 * `config.bounds` in both of MapLibre's forms (ml-aot.76) — browser
 * verification and demo (examples/verification/bounds-forms.html).
 *
 * `[west, south, east, north]` and `[[west, south], [east, north]]` frame
 * the same camera; the corner form used to fail validation with
 * "config.bounds.0: Expected number, got array".
 */
import { test, expect } from "@playwright/test";

test("both bounds forms validate and frame the same camera", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/examples/verification/bounds-forms.html", { waitUntil: "domcontentloaded" });
  const cameras = await page.evaluate(async () =>
    Promise.all(
      ["flat", "corners"].map(async (id) => {
        const map = await (document.getElementById(id) as any).mapReady();
        const c = map.getCenter();
        const b = map.getBounds();
        return {
          lng: c.lng,
          lat: c.lat,
          zoom: map.getZoom(),
          contains:
            b.getWest() <= -74.02 + 1e-6 &&
            b.getEast() >= -73.92 - 1e-6 &&
            b.getSouth() <= 40.645 + 1e-6 &&
            b.getNorth() >= 40.8 - 1e-6,
        };
      })
    )
  );
  await expect(page.locator(".ml-map-error")).toHaveCount(0);
  const [flat, corners] = cameras;
  expect(flat.contains).toBe(true);
  expect(flat.zoom).toBeGreaterThan(9);
  expect(corners.zoom).toBeCloseTo(flat.zoom, 6);
  expect(corners.lng).toBeCloseTo(flat.lng, 6);
  expect(corners.lat).toBeCloseTo(flat.lat, 6);
  await page.screenshot({ path: "e2e/results/small_bounds-forms.png" });
  expect(errors).toEqual([]);
});
