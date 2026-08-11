/**
 * Vanilla eject → attachInteractions example — browser verification.
 *
 * @remarks
 * The user-facing example `examples/vanilla/eject-and-attach.html` tells the
 * eject story end-to-end: a YAML document is compiled to a self-contained
 * `style.json` (eject), rendered in a PLAIN `new maplibregl.Map({ style })`,
 * and then `attachInteractions` reattaches the declarative interactions so a
 * click opens a popup on a map the library never rendered.
 *
 * This spec proves the example actually works, and stays hermetic: the page
 * loads with no page/console errors and no off-origin requests, the ejected
 * map renders and its feature is hit-testable, and a click after attach opens
 * a `.maplibregl-popup` — the proof that interactions survive eject.
 */
import { test, expect, type Page } from "@playwright/test";

const PAGE = "/examples/vanilla/eject-and-attach.html";

/** Fail the test on any page error or off-origin request (hermeticity). */
async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || url.startsWith("data:")) {
      return route.continue();
    }
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return errors;
}

test.describe("vanilla eject → attachInteractions", () => {
  test("ejected style renders in plain maplibre-gl and a click opens a popup", async ({
    page,
  }) => {
    const errors = await guard(page);
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });

    // The eject + attach flow wired up without throwing.
    await page.waitForFunction(
      () => (window as any).__ejectAttach?.ready === true || (window as any).__ejectAttach?.error,
      undefined,
      { timeout: 60_000 }
    );
    const demoError = await page.evaluate(() => (window as any).__ejectAttach.error);
    expect(demoError, `page reported: ${demoError}`).toBeNull();

    // The ejected style really renders: the canvas is present, the layer is
    // loaded, and the feature under the map centre is hit-testable.
    await expect(page.locator("#map canvas.maplibregl-canvas")).toBeVisible();
    await page.waitForFunction(
      () => {
        const map = (window as any).__ejectAttach?.map;
        if (!map || !map.isStyleLoaded?.() || !map.getLayer?.("parcels-fill")) return false;
        const pt = map.project(map.getCenter());
        return map.queryRenderedFeatures(pt, { layers: ["parcels-fill"] }).length > 0;
      },
      undefined,
      { timeout: 60_000 }
    );

    // No popup before the click.
    expect(await page.locator(".maplibregl-popup").count()).toBe(0);

    // Click the feature under the map centre. Fire the delegated map event, the
    // same way the interactions suite does, so the click lands on the polygon.
    await page.evaluate(() => {
      const map = (window as any).__ejectAttach.map;
      const c = map.getCenter();
      map.fire("click", { lngLat: c, point: map.project(c) });
    });

    // The reattached interaction opened the popup on the ejected map, built from
    // the clicked feature's data — proof interactions survived eject.
    const popup = page.locator(".maplibregl-popup");
    await expect(popup).toBeVisible();
    const popupHtml = await page.locator(".maplibregl-popup-content").innerHTML();
    expect(popupHtml).toContain("Study area");
    expect(popupHtml).toContain("under review");

    // The hermetic guard: no console errors, no off-origin requests.
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
