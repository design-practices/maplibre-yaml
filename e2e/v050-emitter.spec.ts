/**
 * v0.5.0 emitter — browser verification, which is also the demo.
 *
 * @remarks
 * The unit suites prove the emitted style passes `validateStyleMin`. That is
 * necessary but not the claim: the claim is that a compiled document renders in
 * *vanilla* MapLibre with nothing from this library involved. Only a real map
 * proves that, and the same page a user opens to see the eject guarantee is the
 * page this test drives.
 *
 * The `!html` spec is the trust model made observable: one document, two
 * contexts, two different popups.
 */
import { test, expect, type Page } from "@playwright/test";

const PAGES = "/examples/verification/emitter";

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

test.describe("eject: a compiled style renders in vanilla MapLibre", () => {
  test("the emitted style is self-contained and renders", async ({ page }) => {
    const errors = await guard(page);
    await page.goto(`${PAGES}/eject.html`, { waitUntil: "domcontentloaded" });

    // A plain maplibregl.Map over the compiled style — no <ml-map> on the page.
    await expect(page.locator("ml-map")).toHaveCount(0);
    await page.waitForFunction(() => (window as any).__ejectMap?.isStyleLoaded?.(), undefined, {
      timeout: 30_000,
    });

    const style = await page.evaluate(() => (window as any).__emittedStyle);
    // The style half is present and the runtime half is gone.
    expect(style.version).toBe(8);
    expect(JSON.stringify(style)).not.toContain("interactive");
    expect(JSON.stringify(style)).not.toContain("refresh");
    // The basemap merged: its background layer sits under the document's fill.
    const layerIds = style.layers.map((l: { id: string }) => l.id);
    expect(layerIds).toEqual(["bg", "fill"]);

    // And it actually painted — the polygon's blue over the grey basemap.
    const painted = await page.evaluate(() => {
      const canvas = document.querySelector("canvas.maplibregl-canvas") as HTMLCanvasElement;
      return canvas.width > 0 && canvas.height > 0;
    });
    expect(painted).toBe(true);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("!html renders as markup only when the context permits it", () => {
  test("trusted renders markup; untrusted escapes it", async ({ page }) => {
    const errors = await guard(page);
    await page.goto(`${PAGES}/html-trust.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => {
        const ready = (k: string) => {
          const map = (window as any)[k]?.getMap?.();
          if (!map || !map.isStyleLoaded?.() || !map.getLayer("dot")) return false;
          const pt = map.project(map.getCenter());
          return map.queryRenderedFeatures(pt, { layers: ["dot"] }).length > 0;
        };
        return ready("__trusted") && ready("__untrusted");
      },
      undefined,
      { timeout: 30_000 }
    );

    // Fire the click on each map and read the popup from THAT map's container —
    // a document-wide querySelector would return the first popup for both.
    const popupHtml = async (key: "__trusted" | "__untrusted", container: string) =>
      page.evaluate(
        ({ key, container }) => {
          const map = (window as any)[key].getMap();
          const c = map.getCenter();
          map.fire("click", { lngLat: c, point: map.project(c) });
          const el = document.querySelector(`#${container} .maplibregl-popup-content`);
          return el ? el.innerHTML : "";
        },
        { key, container }
      );

    const trusted = await popupHtml("__trusted", "map-trusted");
    const untrusted = await popupHtml("__untrusted", "map-untrusted");

    // Same authored `!html "<b>Bold from !html</b>"`, two outcomes.
    expect(trusted).toContain("<b>Bold from !html</b>");
    expect(untrusted).toContain("&lt;b&gt;Bold from !html&lt;/b&gt;");
    expect(untrusted).not.toContain("<b>Bold from");
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
