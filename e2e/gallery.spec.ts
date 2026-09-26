/**
 * MapLibre-examples gallery — browser verification, which is also the demo.
 *
 * @remarks
 * Each shipped gallery page (docs site, `/examples/gallery/`) has a hermetic
 * twin in `examples/gallery/configs/` — same document shape, local basemap,
 * inline data — driven through `examples/gallery/viewer.html`. The unit suites
 * prove the parser and renderer contracts; what only a browser proves is the
 * gallery's actual claim: *this YAML document renders the map the upstream
 * example renders*. If a config regresses (schema drift, renderer change, a
 * curated-key removal), the twin stops drawing and this suite catches it.
 *
 * The page a human opens to see an example is the page this test drives.
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

/** One row per gallery twin: expected layers, plus one layer to prove painted features on. */
const CASES: Array<{ slug: string; layers: string[]; rendered?: string }> = [
  { slug: "display-a-map", layers: [] },
  { slug: "add-a-geojson-line", layers: ["route"], rendered: "route" },
  { slug: "add-a-geojson-polygon", layers: ["maine"], rendered: "maine" },
  { slug: "draw-geojson-points", layers: ["cities"], rendered: "cities" },
  { slug: "display-a-popup-on-click", layers: ["places"], rendered: "places" },
  {
    slug: "create-and-style-clusters",
    layers: ["clusters", "unclustered-point"],
    rendered: "clusters",
  },
  // Heatmap layers are painted as a density surface; layer presence + a
  // painted canvas is the meaningful assertion here.
  { slug: "create-a-heatmap-layer", layers: ["earthquakes-heat", "earthquakes-point"] },
  {
    slug: "extrude-polygons-for-3d-indoor-mapping",
    layers: ["room-extrusion"],
    rendered: "room-extrusion",
  },
  // Wave 1b. Raster layers are not feature-queryable, so tile-backed twins
  // assert layer presence + painted canvas. `add-a-vector-tile-source` and
  // `add-a-video` have no hermetic twins: no local vector tileset or video
  // asset exists, and faking either would test nothing real.
  { slug: "display-a-satellite-map", layers: ["satellite"] },
  { slug: "add-a-wms-source", layers: ["wms-imagery"] },
  { slug: "display-a-non-interactive-map", layers: [] },
  { slug: "change-the-default-position-for-attribution", layers: [] },
  { slug: "display-map-navigation-controls", layers: [] },
  { slug: "view-a-fullscreen-map", layers: [] },
  { slug: "fit-a-map-to-a-bounding-box", layers: [] },
  { slug: "restrict-map-panning-to-an-area", layers: [] },
  {
    slug: "add-multiple-geometries-from-one-geojson-source",
    layers: ["park-boundary", "park-points"],
    rendered: "park-boundary",
  },
  { slug: "show-polygon-information-on-click", layers: ["state"], rendered: "state" },
  { slug: "add-live-realtime-data", layers: ["drone"], rendered: "drone" },
];

async function openExample(page: Page, slug: string, layers: string[]): Promise<void> {
  await page.goto(`/examples/gallery/viewer.html?example=${slug}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    (ids) => {
      const map = (document.getElementById("map") as any)?.getMap?.();
      if (!map || !map.isStyleLoaded?.()) return false;
      return ids.every((id: string) => Boolean(map.getLayer?.(id)));
    },
    layers,
    { timeout: 60_000 }
  );
}

test.describe("gallery twins: each shipped example's YAML renders via <ml-map>", () => {
  for (const { slug, layers, rendered } of CASES) {
    test(slug, async ({ page }) => {
      const errors = await guard(page);
      await openExample(page, slug, layers);

      // The map actually painted — a real canvas with non-zero extent.
      const painted = await page.evaluate(() => {
        const c = document
          .getElementById("map")!
          .querySelector("canvas.maplibregl-canvas") as HTMLCanvasElement | null;
        return Boolean(c && c.width > 0 && c.height > 0);
      });
      expect(painted, "map canvas did not paint").toBe(true);

      // The data layer put real features on screen, not just an entry in the
      // style — queryRenderedFeatures only returns what was drawn.
      if (rendered) {
        await page.waitForFunction(
          (layerId) => {
            const map = (document.getElementById("map") as any)?.getMap?.();
            return (map?.queryRenderedFeatures?.(undefined, { layers: [layerId] }) ?? []).length > 0;
          },
          rendered,
          { timeout: 30_000 }
        );
      }

      expect(errors, `page errors for ${slug}:\n${errors.join("\n")}`).toEqual([]);
    });
  }

  test("display-a-popup-on-click: clicking a feature opens its allowlisted popup", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openExample(page, "display-a-popup-on-click", ["places"]);

    // Click exactly where the first feature projects to on screen.
    const pt = await page.evaluate(() => {
      const map = (document.getElementById("map") as any).getMap();
      const p = map.project([-77.038659, 38.931567]);
      const rect = map.getCanvas().getBoundingClientRect();
      return { x: rect.left + p.x, y: rect.top + p.y };
    });
    // Wait until the feature is actually hit-testable at that pixel, then click.
    await page.waitForFunction(
      ({ x, y }) => {
        const map = (document.getElementById("map") as any).getMap();
        const rect = map.getCanvas().getBoundingClientRect();
        return (
          map.queryRenderedFeatures([x - rect.left, y - rect.top], { layers: ["places"] })
            .length > 0
        );
      },
      pt,
      { timeout: 30_000 }
    );
    await page.mouse.click(pt.x, pt.y);

    const popup = page.locator(".maplibregl-popup");
    await expect(popup).toBeVisible();
    await expect(popup.locator("h3")).toHaveText("Make it Mount Pleasant");

    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("controls pages: each YAML controls entry produces its DOM control where declared", async ({
    page,
  }) => {
    await guard(page);

    await openExample(page, "display-map-navigation-controls", []);
    await expect(
      page.locator(".maplibregl-ctrl-top-left .maplibregl-ctrl-zoom-in")
    ).toBeVisible();

    await openExample(page, "view-a-fullscreen-map", []);
    await expect(page.locator(".maplibregl-ctrl-fullscreen")).toBeVisible();

    await openExample(page, "change-the-default-position-for-attribution", []);
    await expect(
      page.locator(".maplibregl-ctrl-top-left .maplibregl-ctrl-attrib")
    ).toBeVisible();
  });

  test("camera-config pages: bounds frames the box, maxBounds constrains, interactive:false disables handlers", async ({
    page,
  }) => {
    await guard(page);

    // config.bounds → the initial camera centers on the box, not on `center`.
    await openExample(page, "fit-a-map-to-a-bounding-box", []);
    const centerLng = await page.evaluate(
      () => (document.getElementById("map") as any).getMap().getCenter().lng
    );
    expect(centerLng).toBeGreaterThan(35);
    expect(centerLng).toBeLessThan(41);

    await openExample(page, "restrict-map-panning-to-an-area", []);
    const maxBounds = await page.evaluate(() =>
      Boolean((document.getElementById("map") as any).getMap().getMaxBounds())
    );
    expect(maxBounds, "maxBounds not applied").toBe(true);

    await openExample(page, "display-a-non-interactive-map", []);
    const handlers = await page.evaluate(() => {
      const map = (document.getElementById("map") as any).getMap();
      return {
        dragPan: map.dragPan.isEnabled(),
        scrollZoom: map.scrollZoom.isEnabled(),
      };
    });
    expect(handlers).toEqual({ dragPan: false, scrollZoom: false });
  });

  test("add-live-realtime-data: the poll loop keeps delivering data", async ({ page }) => {
    const errors = await guard(page);
    await openExample(page, "add-live-realtime-data", ["drone"]);

    // Two ticks past the initial load prove the interval loop, not just the
    // first fetch. Events arrive on the <ml-map> element itself.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          let ticks = 0;
          document.getElementById("map")!.addEventListener("ml-map:layer-data-loaded", () => {
            if (++ticks >= 2) resolve();
          });
        })
    );

    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});
