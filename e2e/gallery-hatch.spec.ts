/**
 * YAML + JavaScript gallery pages — browser verification, which is also the demo.
 *
 * @remarks
 * Wave 3 pages pair a YAML document with a few lines of page JS through a
 * documented hatch (getMap(), DOM events, updateLayerData, an inline style
 * object). Each twin here loads the SAME JS file the docs page ships
 * (docs/public/gallery-js/<slug>.js) — and, since U16 / ml-7fb, the SAME
 * page-chrome fragment (<slug>.html), whose controls ride <ml-map>'s
 * corner slots — through examples/gallery/hatch/twin.html, against a
 * hermetic config, and the
 * tests assert the hatch's BEHAVIOR — the camera flies, the filter filters,
 * the paint repaints — not just that a map appeared. The protocol hatch
 * (pmtiles-source-and-protocol) exercises U2's `@maplibre-yaml/core/maplibre`
 * subpath: a stub scheme registered through it must serve a document source,
 * proving the subpath and the renderer share one maplibre-gl instance.
 */
import { test, expect, type Page } from "@playwright/test";

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

async function openHatch(page: Page, slug: string, layers: string[]): Promise<void> {
  // pmtiles keeps its bespoke twin: it registers a stub protocol inline.
  const url =
    slug === "pmtiles-source-and-protocol"
      ? `/examples/gallery/hatch/${slug}.html`
      : `/examples/gallery/hatch/twin.html?slug=${slug}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    (ids) => {
      const map = (document.getElementById("map") as any)?.getMap?.();
      // `_loaded` (the map's load fired), not isStyleLoaded(): a hatch that
      // writes a source every frame keeps the latter false indefinitely.
      if (!map || !map._loaded) return false;
      return ids.every((id: string) => Boolean(map.getLayer?.(id)));
    },
    layers,
    { timeout: 60_000 }
  );
}

const qrfCount = (page: Page, layerId: string) =>
  page.evaluate(
    (id) =>
      (document.getElementById("map") as any)
        .getMap()
        .queryRenderedFeatures(undefined, { layers: [id] }).length,
    layerId
  );

test.describe("YAML + JavaScript pages: the shipped JS drives the shipped YAML", () => {
  test("fly-to-a-location: a button flight lands on its target", async ({ page }) => {
    const errors = await guard(page);
    await openHatch(page, "fly-to-a-location", []);

    const settled = page.evaluate(
      () =>
        new Promise<{ lng: number; lat: number }>((resolve) => {
          const map = (document.getElementById("map") as any).getMap();
          map.on("moveend", () => resolve(map.getCenter()));
        })
    );
    // ml-7fb: the buttons ride <ml-map>'s top-left corner slot.
    await expect(
      page.locator('.ml-map-chrome-top-left [data-fly="[-0.1276,51.5072]"]')
    ).toBeVisible();
    await page.click('[data-fly="[-0.1276,51.5072]"]');
    const center = await settled;
    expect(Math.abs(center.lng - -0.1276)).toBeLessThan(0.01);
    expect(Math.abs(center.lat - 51.5072)).toBeLessThan(0.01);
    expect(errors).toEqual([]);
  });

  test("filter-within-a-layer: the slider filters features out", async ({ page }) => {
    const errors = await guard(page);
    await openHatch(page, "filter-within-a-layer", ["quakes"]);

    await page.waitForFunction(
      () =>
        (document.getElementById("map") as any)
          .getMap()
          .queryRenderedFeatures(undefined, { layers: ["quakes"] }).length === 8
    );

    await expect(page.locator(".ml-map-chrome-top-left [data-filter-mag]")).toBeVisible();
    // Drive the slider to 4.0 and let the input handler run setFilter.
    await page.locator("[data-filter-mag]").fill("4");
    await page.waitForFunction(
      () =>
        (document.getElementById("map") as any)
          .getMap()
          .queryRenderedFeatures(undefined, { layers: ["quakes"] }).length === 3
    );
    expect(await qrfCount(page, "quakes")).toBe(3); // mags 4.4, 5.1, 4.7
    expect(errors).toEqual([]);
  });

  test("get-features-under-the-mouse-pointer: hover fills the info panel via DOM events", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openHatch(page, "get-features-under-the-mouse-pointer", ["landmarks"]);

    const pt = await page.evaluate(() => {
      const map = (document.getElementById("map") as any).getMap();
      const p = map.project([-73.9857, 40.7484]);
      const rect = map.getCanvas().getBoundingClientRect();
      return { x: rect.left + p.x, y: rect.top + p.y };
    });
    await page.waitForFunction(
      ({ x, y }) => {
        const map = (document.getElementById("map") as any).getMap();
        const rect = map.getCanvas().getBoundingClientRect();
        return (
          map.queryRenderedFeatures([x - rect.left, y - rect.top], { layers: ["landmarks"] })
            .length > 0
        );
      },
      pt,
      { timeout: 30_000 }
    );
    await page.mouse.move(pt.x, pt.y);
    await expect(page.locator(".ml-map-chrome-top-left [data-feature-info]")).toContainText(
      "Empire State Building"
    );
    expect(errors).toEqual([]);
  });

  test("animate-a-point: updateLayerData moves the feature", async ({ page }) => {
    const errors = await guard(page);
    await openHatch(page, "animate-a-point", ["orbiter"]);

    const position = () =>
      page.evaluate(() => {
        const map = (document.getElementById("map") as any).getMap();
        const f = map.queryRenderedFeatures(undefined, { layers: ["orbiter"] })[0];
        return f ? (f.geometry as any).coordinates.join(",") : null;
      });
    await page.waitForFunction(
      () =>
        (document.getElementById("map") as any)
          .getMap()
          .queryRenderedFeatures(undefined, { layers: ["orbiter"] }).length > 0
    );
    const a = await position();
    await page.waitForTimeout(600);
    const b = await position();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b).not.toBe(a);
    expect(errors).toEqual([]);
  });

  test("style-labels-with-web-fonts: an inline style object boots the map", async ({ page }) => {
    const errors = await guard(page);
    await openHatch(page, "style-labels-with-web-fonts", ["backdrop", "city-labels"]);
    // backdrop comes from the INLINE style object; city-labels from layers:.
    expect(errors).toEqual([]);
  });

  test("fly-to-a-location: a click BEFORE load waits via mapReady and still lands (U2)", async ({
    page,
  }) => {
    const errors = await guard(page);
    // No openHatch wait — click as soon as the button exists, racing the map.
    // Slot children stay hidden until the map's load (U9), so a user can no
    // longer reach the button early; a programmatic click still can, and
    // must still land.
    await page.goto(`/examples/gallery/hatch/twin.html?slug=fly-to-a-location`, {
      waitUntil: "domcontentloaded",
    });
    // Click the moment the page's own JS has attached its listener.
    await page.waitForFunction(() => document.documentElement.dataset.hatchReady);
    await page
      .locator('[data-fly="[-0.1276,51.5072]"]')
      .evaluate((b: HTMLButtonElement) => b.click());

    // mapReady() inside the handler defers the flight until the map exists;
    // the old getMap() null-guard dropped this click on the floor.
    await page.waitForFunction(
      () => {
        const map = (document.getElementById("map") as any)?.getMap?.();
        if (!map) return false;
        const c = map.getCenter();
        return Math.abs(c.lng - -0.1276) < 0.05 && Math.abs(c.lat - 51.5072) < 0.05;
      },
      undefined,
      { timeout: 60_000 }
    );

    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("pmtiles-source-and-protocol: addProtocol via the core/maplibre subpath serves a document source (U2)", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openHatch(page, "pmtiles-source-and-protocol", ["protocol-cities"]);

    // The source URL (stub://cities.geojson) is resolvable ONLY through the
    // protocol registered via the subpath — features on screen prove the
    // subpath and the renderer share one maplibre-gl module instance.
    await page.waitForFunction(
      () =>
        (document.getElementById("map") as any)
          .getMap()
          .queryRenderedFeatures(undefined, { layers: ["protocol-cities"] }).length > 0,
      undefined,
      { timeout: 30_000 }
    );

    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});
