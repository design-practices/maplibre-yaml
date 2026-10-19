/**
 * A label layer without text-font borrows the basemap's font (ml-aot.53) —
 * browser verification and demo
 * (examples/verification/17-labels-without-text-font.html).
 *
 * The fixture basemap's glyph server only has "Noto Sans Regular", like
 * OpenFreeMap. MapLibre's default stack 404s there and logs a warning per
 * character; with the fix only the basemap's font is requested.
 */
import { test, expect } from "@playwright/test";

test("a label layer without text-font requests only the basemap's font: no glyph 404s", async ({ page }) => {
  const errors: string[] = [];
  const glyphs: Array<{ path: string; status: number }> = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    const path = decodeURIComponent(new URL(r.url()).pathname);
    if (path.endsWith(".pbf")) glyphs.push({ path, status: r.status() });
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || /^(data|blob):/.test(url)) return route.continue();
    errors.push(`external request: ${url}`);
    return route.abort();
  });
  await page.goto("/examples/verification/17-labels-without-text-font.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => (document.getElementById("map") as any).mapReady());
  await expect.poll(() => glyphs.some((g) => g.path.includes("Noto Sans Regular")), { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(1000);
  const font = await page.evaluate(() =>
    (document.getElementById("map") as any).getMap().getLayoutProperty("names", "text-font")
  );
  expect(font).toEqual(["Noto Sans Regular"]);
  expect(glyphs.filter((g) => g.status === 404), JSON.stringify(glyphs)).toEqual([]);
  expect(errors).toEqual([]);
});
