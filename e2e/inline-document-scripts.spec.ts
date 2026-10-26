/**
 * Inline JSON and `application/yaml` documents (ml-4cn.2) — browser
 * verification, which is also the demo
 * (examples/verification/inline-json-yaml-scripts.html).
 *
 * Up to 0.9.1 both elements read only `<script type="text/yaml">` (the story
 * also `application/yaml`), so a JSON or `application/yaml` script showed
 * "No configuration provided" even though the element's own stylesheet hid
 * those scripts. Here an `<ml-map>` with an `application/json` document and
 * an `<ml-scrollytelling>` with an `application/yaml` one must both draw.
 */
import { test, expect } from "@playwright/test";

const PAGE = "/examples/verification/inline-json-yaml-scripts.html";

test("an inline application/json map and an inline application/yaml story both render", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || /^(data|blob):/.test(url)) return route.continue();
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });

  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => (document.getElementById("map") as any).mapReady());
  await page.evaluate(() => (document.getElementById("story") as any).mapReady());

  // The documents' own layers are on the maps and draw features.
  for (const [id, layer] of [
    ["map", "json-point"],
    ["story", "yaml-point"],
  ] as const) {
    await page.waitForFunction(
      ({ id, layer }) => {
        const map = (document.getElementById(id) as any)?.getMap?.();
        return Boolean(map?.getLayer(layer)) && map.queryRenderedFeatures(undefined, { layers: [layer] }).length > 0;
      },
      { id, layer },
      { timeout: 45_000 }
    );
  }

  expect(await page.locator("#map").evaluate((el: any) => el.getMap().getCenter().toArray())).toEqual([0, 0]);
  await expect(page.locator("#story .scrolly-chapter")).toHaveCount(2);
  await expect(page.locator(".ml-map-error, .scrolly-error")).toHaveCount(0);
  await expect(page.getByText("No configuration provided")).toHaveCount(0);
  // The document scripts stay hidden.
  await expect(page.locator('script[type="application/json"]')).toBeHidden();
  await expect(page.locator('script[type="application/yaml"]')).toBeHidden();
  expect(errors).toEqual([]);
});
