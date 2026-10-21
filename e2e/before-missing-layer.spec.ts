/**
 * `before:` naming a layer the map doesn't have (ml-aot.119) — browser
 * verification, which is also the demo
 * (examples/verification/23-before-missing-layer.html).
 *
 * @remarks
 * MapLibre refuses `addLayer(layer, before)` when `before` names no layer, so
 * a one-letter typo made the author's data vanish with only a console error.
 * The layer now goes on top, and the author notes say so with the closest
 * layer id — for an inline basemap and for one loaded from a URL.
 */
import { test, expect } from "@playwright/test";

test("a before: typo still draws the layer, on top, with a did-you-mean", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/examples/verification/23-before-missing-layer.html", { waitUntil: "domcontentloaded" });
  for (const [id, layer, near] of [
    ["inline", "dot", "places_subplace"],
    ["url", "outline", "labels"],
  ] as const) {
    await page.evaluate((id) => (document.getElementById(id) as any).mapReady(), id);
    const order = await page.evaluate(
      (id) => (document.getElementById(id) as any).getMap().getStyle().layers.map((l: any) => l.id),
      id
    );
    expect(order.at(-1)).toBe(layer);
    await expect(page.locator(`#${id} .ml-map-notice`)).toContainText(
      `Did you mean ${near}?`
    );
    await expect(page.locator(`#${id} .ml-map-notice`)).toContainText("is drawn on top instead");
  }
  await page.screenshot({ path: "e2e/results/before_missing_layer.png" });
  expect(errors).toEqual([]);
});
