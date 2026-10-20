/**
 * `fitTo` keeps a margin around the data (0.9, ml-aot.124, ml-aot.112) —
 * browser verification, which is also the demo
 * (examples/verification/fit-to-padding.html).
 *
 * @remarks
 * Fitting to the data's exact extent cut the outermost circles in half and,
 * on a phone, hid the bottom one under MapLibre's attribution (which starts
 * expanded on a narrow map). Without `padding:`, `fitTo` now frames with a
 * margin scaled to the map plus room for the attribution. Asserted on a
 * desktop window and a phone: every circle (radius 9 + stroke 2) lies wholly
 * inside the canvas and clear of the attribution.
 */
import { test, expect, type Page } from "@playwright/test";

const RADIUS = 11; // circle-radius 9 + circle-stroke-width 2

async function circlesAndAttribution(page: Page) {
  await page.goto("/examples/verification/fit-to-padding.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => (document.getElementById("map") as any).mapReady());
  return measure(page);
}

function measure(page: Page) {
  return page.evaluate(() => {
    const map = (document.getElementById("map") as any).getMap();
    const canvas = map.getCanvas().getBoundingClientRect();
    const attrib = document.querySelector("#map .maplibregl-ctrl-attrib")?.getBoundingClientRect();
    const points = [
      [-73.9654, 40.7829],
      [-73.969, 40.6602],
      [-74.0021, 40.7539],
      [-73.9496, 40.7447],
      [-73.9419, 40.73],
    ].map((ll) => {
      const p = map.project(ll);
      return { x: canvas.left + p.x, y: canvas.top + p.y };
    });
    return {
      canvas: { left: canvas.left, top: canvas.top, right: canvas.right, bottom: canvas.bottom },
      attrib: attrib ? { left: attrib.left, top: attrib.top, right: attrib.right, bottom: attrib.bottom } : null,
      points,
    };
  });
}

for (const [name, viewport] of [
  ["desktop", { width: 1280, height: 800 }],
  ["phone 390", { width: 390, height: 844 }],
  ["phone 360", { width: 360, height: 740 }],
] as const) {
  test(`fitTo without padding: every edge circle is whole and clear of the attribution, collapsed and expanded (${name})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const check = (state: Awaited<ReturnType<typeof circlesAndAttribution>>, label: string) => {
      const { canvas, attrib, points } = state;
      for (const p of points) {
        expect(p.x - RADIUS).toBeGreaterThanOrEqual(canvas.left);
        expect(p.x + RADIUS).toBeLessThanOrEqual(canvas.right);
        expect(p.y - RADIUS).toBeGreaterThanOrEqual(canvas.top);
        expect(p.y + RADIUS).toBeLessThanOrEqual(canvas.bottom);
        if (attrib) {
          const overlaps =
            p.x + RADIUS > attrib.left && p.x - RADIUS < attrib.right && p.y + RADIUS > attrib.top && p.y - RADIUS < attrib.bottom;
          expect(overlaps, `${label}: circle at ${Math.round(p.x)},${Math.round(p.y)} under the attribution`).toBe(false);
        }
      }
    };
    const first = await circlesAndAttribution(page);
    const expanded = await page.evaluate(() =>
      document.querySelector("#map .maplibregl-ctrl-attrib")!.classList.contains("maplibregl-compact-show")
    );
    check(first, expanded ? "expanded" : "collapsed");
    // The other state: tap (i).
    await page.locator("#map .maplibregl-ctrl-attrib-button").click();
    const toggled = await page.evaluate(() =>
      document.querySelector("#map .maplibregl-ctrl-attrib")!.classList.contains("maplibregl-compact-show")
    );
    expect(toggled).toBe(!expanded);
    check(await measure(page), toggled ? "expanded" : "collapsed");
    await page.screenshot({ path: `e2e/results/fit_padding_${name.replace(" ", "_")}.png` });
  });
}
