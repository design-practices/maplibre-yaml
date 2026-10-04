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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  meetsVersion,
  STATE_RUNTIME_FLOOR,
  GLOBE_RUNTIME_FLOOR,
} from "../packages/core/src/capabilities";

/**
 * The maplibre-gl version the e2e vendor serves (root devDependency — the
 * same resolution `e2e/server.mjs` uses). The CI matrix overrides it per
 * leg, so version-gated twins read it here rather than assuming 5.x.
 */
const VENDOR_MAPLIBRE_VERSION: string = JSON.parse(
  readFileSync(join(process.cwd(), "node_modules/maplibre-gl/package.json"), "utf8")
).version;

/**
 * True when the vendor supports `global-state` expressions. Delegates to
 * core's own floor + comparator so the gate can never drift from the
 * runtime capability the library itself enforces.
 */
function vendorHasGlobalState(): boolean {
  return meetsVersion(VENDOR_MAPLIBRE_VERSION, STATE_RUNTIME_FLOOR);
}

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
  // Wave 2. Config-flag pages assert behavior in the bespoke tests below;
  // label twins assert presence + error-freeness (the local style serves
  // empty glyphs, so no visible text renders hermetically). Docs-only, no
  // twin: display-buildings-in-3d and change-building-color-based-on-zoom-level
  // (both draw from the remote openfreemap basemap's own source — no local
  // vector tileset can stand in honestly).
  { slug: "set-pitch-and-bearing", layers: [] },
  { slug: "hash-routing", layers: [] },
  { slug: "render-world-copies", layers: [] },
  { slug: "locate-the-user", layers: [] },
  { slug: "cooperative-gestures", layers: [] },
  { slug: "disable-map-rotation", layers: [] },
  { slug: "disable-scroll-zoom", layers: [] },
  { slug: "add-a-raster-tile-source", layers: ["osm-raster"] },
  {
    slug: "display-line-that-crosses-180th-meridian",
    layers: ["crossing"],
    rendered: "crossing",
  },
  { slug: "update-a-feature-in-realtime", layers: ["quakes-live"], rendered: "quakes-live" },
  { slug: "add-a-new-layer-below-labels", layers: ["wash-below-labels"] },
  { slug: "add-a-hillshade-layer", layers: ["hillshade"] },
  { slug: "display-and-style-rich-text-labels", layers: ["city-labels"] },
  { slug: "change-the-case-of-labels", layers: ["shouting-labels"] },
  { slug: "variable-label-placement", layers: ["poi-labels"] },
  { slug: "variable-label-placement-with-offset", layers: ["poi-labels"] },
  { slug: "use-locally-generated-ideographs", layers: ["city-labels-ja"] },
  {
    slug: "style-lines-with-a-data-driven-property",
    layers: ["colored-lines"],
    rendered: "colored-lines",
  },
  {
    slug: "create-a-gradient-line-using-an-expression",
    layers: ["gradient-line"],
    rendered: "gradient-line",
  },
  {
    slug: "create-a-gradient-dashed-line-using-an-expression",
    layers: ["gradient-dashed-line"],
    rendered: "gradient-dashed-line",
  },
  { slug: "visualize-population-density", layers: ["density"], rendered: "density" },
  { slug: "create-a-hover-effect", layers: ["states"], rendered: "states" },
  {
    slug: "center-the-map-on-a-clicked-symbol",
    layers: ["islands"],
    rendered: "islands",
  },
  // U6 `images:` — icon, coalesce fallback, and fill-pattern twins
  { slug: "add-an-icon-to-the-map", layers: ["logo"], rendered: "logo" },
  { slug: "use-a-fallback-image", layers: ["fallback"], rendered: "fallback" },
  { slug: "add-a-pattern-to-a-polygon", layers: ["patterned"], rendered: "patterned" },
  // U15 map-level 3D — terrain/sky/projection twins over the server's
  // synthetic /relief DEM and /landcover raster. The bespoke test below
  // proves each 3D key reached the live map (or declared its absence on 4.x).
  { slug: "3d-terrain", layers: ["osm", "hills"] },
  { slug: "display-a-hybrid-satellite-map-with-terrain-elevation", layers: ["satellite", "hills"] },
  { slug: "sky-fog-terrain", layers: ["osm", "hills"] },
  { slug: "display-a-globe-with-a-vector-map", layers: ["land", "graticule"] },
  { slug: "display-a-globe-with-an-atmosphere", layers: ["Satellite"] },
  {
    slug: "display-a-globe-with-a-fill-extrusion-layer",
    layers: ["extrude-polygon-layer"],
  },
  {
    slug: "create-a-heatmap-layer-on-a-globe-with-terrain-elevation",
    layers: ["hills", "earthquakes-heat", "earthquakes-point"],
  },
];

/** True when the vendor has globe projection (maplibre-gl >= 5.0.0). */
function vendorHasGlobe(): boolean {
  return meetsVersion(VENDOR_MAPLIBRE_VERSION, GLOBE_RUNTIME_FLOOR);
}

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

  test("U15 3D trio: terrain raises the surface, sky lands, globe projects (or declares absence on 4.x)", async ({
    page,
  }) => {
    const errors = await guard(page);
    const warnings: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "warning") warnings.push(m.text());
    });

    // terrain: — applied from the named DEM source, the control toggles it,
    // and the synthetic relief is actually under the camera (an elevation
    // query only answers once terrain is live and its tiles decoded).
    await openExample(page, "3d-terrain", ["osm", "hills"]);
    expect(
      await page.evaluate(() =>
        (document.getElementById("map") as any).getMap().getTerrain()
      )
    ).toEqual({ source: "terrainSource", exaggeration: 1 });
    await expect(page.locator(".maplibregl-ctrl-terrain-enabled")).toBeVisible();
    await page.waitForFunction(
      () => {
        // Relief, not an absolute height: 4.x reports elevation relative to
        // the camera target, 5.x above sea level — the spread is the same.
        const map = (document.getElementById("map") as any).getMap();
        const c = map.getCenter();
        const samples = [-0.06, -0.03, 0, 0.03, 0.06].map((d) =>
          map.queryTerrainElevation?.([c.lng + d, c.lat + d / 2])
        );
        if (!samples.every((e: unknown) => typeof e === "number")) return false;
        return Math.max(...samples) - Math.min(...samples) > 100;
      },
      undefined,
      { timeout: 30_000 }
    );

    // sky: — the authored block reached the style (setSky, maplibre-gl >= 4.5).
    await openExample(page, "sky-fog-terrain", ["osm", "hills"]);
    const sky = await page.evaluate(() =>
      (document.getElementById("map") as any).getMap().getSky?.()
    );
    expect(sky?.["sky-color"]).toBe("#0000ff");
    expect(sky?.["fog-ground-blend"]).toBe(0.1);

    // projection: — globe on 5.x; on the 4.x leg, exactly one declared
    // absence naming the floor, and the map still renders (mercator).
    // Waiting on a document layer means the load handler (which applies the
    // projection before adding layers) has run.
    // A whole-viewport queryRenderedFeatures() comes back empty under globe
    // (the viewport corners are off the planet), so features are proven at
    // a point: where a known feature projects on screen.
    for (const [slug, layer, at] of [
      ["display-a-globe-with-a-vector-map", "land", [-40, 0]],
      ["display-a-globe-with-an-atmosphere", "Satellite", null],
      ["display-a-globe-with-a-fill-extrusion-layer", "extrude-polygon-layer", [0, 0]],
    ] as const) {
      warnings.length = 0;
      await openExample(page, slug, [layer]);
      if (at) {
        await page.waitForFunction(
          ({ layerId, lngLat }) => {
            const map = (document.getElementById("map") as any).getMap();
            const p = map.project(lngLat);
            return map.queryRenderedFeatures([p.x, p.y], { layers: [layerId] }).length > 0;
          },
          { layerId: layer, lngLat: at as unknown as [number, number] },
          { timeout: 30_000 }
        );
      }
      const projection = await page.evaluate(
        () => (document.getElementById("map") as any).getMap().getProjection?.()?.type ?? null
      );
      const absences = warnings.filter((w) => w.includes("projection") && w.includes("5.0.0"));
      if (vendorHasGlobe()) {
        expect(projection, `${slug} projection`).toBe("globe");
        expect(absences, `${slug} must not warn on 5.x`).toEqual([]);
      } else {
        expect(projection, `${slug} has no projection API on 4.x`).toBeNull();
        expect(absences, `${slug} declares globe's absence once`).toHaveLength(1);
      }
    }
    if (vendorHasGlobe()) {
      await expect(page.locator(".maplibregl-ctrl-globe-enabled")).toBeVisible();
    }

    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
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

  test("wave-2 config flags: each YAML flag reaches the live map", async ({ page }) => {
    await guard(page);

    await openExample(page, "set-pitch-and-bearing", []);
    const camera = await page.evaluate(() => {
      const map = (document.getElementById("map") as any).getMap();
      return { pitch: map.getPitch(), bearing: map.getBearing() };
    });
    expect(camera).toEqual({ pitch: 60, bearing: -60 });

    await openExample(page, "render-world-copies", []);
    expect(
      await page.evaluate(() =>
        (document.getElementById("map") as any).getMap().getRenderWorldCopies()
      )
    ).toBe(false);

    await openExample(page, "cooperative-gestures", []);
    expect(
      await page.evaluate(() => {
        const map = (document.getElementById("map") as any).getMap();
        return Boolean(map.cooperativeGestures?.isEnabled?.());
      })
    ).toBe(true);

    await openExample(page, "disable-map-rotation", []);
    expect(
      await page.evaluate(() => {
        const map = (document.getElementById("map") as any).getMap();
        return { drag: map.dragRotate.isEnabled(), touch: map.touchZoomRotate.isEnabled() };
      })
    ).toEqual({ drag: false, touch: false });

    await openExample(page, "disable-scroll-zoom", []);
    expect(
      await page.evaluate(() =>
        (document.getElementById("map") as any).getMap().scrollZoom.isEnabled()
      )
    ).toBe(false);

    await openExample(page, "locate-the-user", []);
    await expect(page.locator(".maplibregl-ctrl-geolocate")).toBeVisible();
  });

  test("hash-routing: the viewport writes itself into the URL", async ({ page }) => {
    await guard(page);
    await openExample(page, "hash-routing", []);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const map = (document.getElementById("map") as any).getMap();
          map.once("moveend", () => resolve());
          map.jumpTo({ center: [10, 45], zoom: 6 });
        })
    );
    expect(page.url()).toContain("#");
  });

  test("add-a-new-layer-below-labels: before places the layer under its target", async ({
    page,
  }) => {
    await guard(page);
    await openExample(page, "add-a-new-layer-below-labels", ["wash-below-labels"]);
    const order = await page.evaluate(() => {
      const map = (document.getElementById("map") as any).getMap();
      const ids = map.getStyle().layers.map((l: any) => l.id);
      return { wash: ids.indexOf("wash-below-labels"), target: ids.indexOf("background") };
    });
    expect(order.wash).toBeGreaterThanOrEqual(0);
    expect(order.wash).toBeLessThan(order.target);
  });

  test("update-a-feature-in-realtime: the merge poll loop keeps delivering", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openExample(page, "update-a-feature-in-realtime", ["quakes-live"]);
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

  test("center-the-map-on-a-clicked-symbol: clicking a point centers the camera on it", async ({
    page,
  }) => {
    await guard(page);
    await openExample(page, "center-the-map-on-a-clicked-symbol", ["islands"]);

    const target = [-91.395, -0.9538] as const;
    const pt = await page.evaluate((lngLat) => {
      const map = (document.getElementById("map") as any).getMap();
      const p = map.project(lngLat as any);
      const rect = map.getCanvas().getBoundingClientRect();
      return { x: rect.left + p.x, y: rect.top + p.y };
    }, target);
    await page.waitForFunction(
      ({ x, y }) => {
        const map = (document.getElementById("map") as any).getMap();
        const rect = map.getCanvas().getBoundingClientRect();
        return (
          map.queryRenderedFeatures([x - rect.left, y - rect.top], { layers: ["islands"] })
            .length > 0
        );
      },
      pt,
      { timeout: 30_000 }
    );
    const settled = page.evaluate(
      () =>
        new Promise<{ lng: number; lat: number }>((resolve) => {
          const map = (document.getElementById("map") as any).getMap();
          map.once("moveend", () => resolve(map.getCenter()));
        })
    );
    await page.mouse.click(pt.x, pt.y);
    const center = await settled;
    expect(Math.abs(center.lng - target[0])).toBeLessThan(0.05);
    expect(Math.abs(center.lat - target[1])).toBeLessThan(0.05);
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

  test("display-a-popup-on-hover: preview on hover, pin on click, suppress while pinned (U7)", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openExample(page, "display-a-popup-on-hover", ["places"]);

    // Project a feature to screen coordinates and wait until hit-testable.
    const pointFor = async (lngLat: [number, number]) =>
      page.evaluate((coords) => {
        const map = (document.getElementById("map") as any).getMap();
        const p = map.project(coords);
        const rect = map.getCanvas().getBoundingClientRect();
        return { x: rect.left + p.x, y: rect.top + p.y };
      }, lngLat);
    const dc: [number, number] = [-77.032, 38.913];
    const chicago: [number, number] = [-87.65, 41.84];
    const pt = await pointFor(dc);
    await page.waitForFunction(
      ({ x, y }) => {
        const map = (document.getElementById("map") as any).getMap();
        const rect = map.getCanvas().getBoundingClientRect();
        return map.queryRenderedFeatures([x - rect.left, y - rect.top], { layers: ["places"] }).length > 0;
      },
      pt,
      { timeout: 30_000 }
    );

    // Hover: a chromeless preview appears.
    await page.mouse.move(pt.x, pt.y);
    const popup = page.locator(".maplibregl-popup");
    await expect(popup).toBeVisible();
    await expect(popup.locator("h3")).toHaveText("Washington DC");
    await expect(popup.locator(".maplibregl-popup-close-button")).toHaveCount(0);

    // Leave: the preview dismisses.
    await page.mouse.move(pt.x + 220, pt.y + 220);
    await expect(popup).toHaveCount(0);

    // Click pins: close button present, and hovering ANOTHER feature is
    // suppressed while the pin is open. Click 3px off the projected anchor —
    // still inside the 8px circle, but clear of the hover popup's tip DOM,
    // which sits exactly at the anchor pixel and would absorb the click.
    await page.mouse.move(pt.x + 3, pt.y + 3);
    await page.mouse.click(pt.x + 3, pt.y + 3);
    await expect(popup.locator(".maplibregl-popup-close-button")).toHaveCount(1);
    const chi = await pointFor(chicago);
    await page.mouse.move(chi.x, chi.y);
    await expect(popup).toHaveCount(1);
    await expect(popup.locator("h3")).toHaveText("Washington DC");

    // Dismiss the pin: hover previews resume.
    await popup.locator(".maplibregl-popup-close-button").click();
    await expect(popup).toHaveCount(0);
    await page.mouse.move(chi.x, chi.y);
    await expect(popup.locator("h3")).toHaveText("Chicago");

    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("filter-features-with-global-state: a `state:` doc's global-state filter renders live (U1, seeds U8)", async ({
    page,
  }) => {
    test.skip(
      !vendorHasGlobalState(),
      `global-state expressions need maplibre-gl >= 5.6 (vendor is ${VENDOR_MAPLIBRE_VERSION}); U8 owns the sub-5.6 declared-absence posture`
    );

    const errors = await guard(page);
    await openExample(page, "filter-features-with-global-state", ["big-cities"]);

    // The filter's default (minPop: 5) let the big cities through…
    await page.waitForFunction(
      () => {
        const map = (document.getElementById("map") as any)?.getMap?.();
        return (
          (map?.queryRenderedFeatures?.(undefined, { layers: ["big-cities"] }) ?? []).length > 0
        );
      },
      undefined,
      { timeout: 30_000 }
    );

    // …and kept every below-threshold feature off the canvas — the filter
    // evaluated against real state, it didn't just fail open.
    const belowThreshold = await page.evaluate(() => {
      const map = (document.getElementById("map") as any).getMap();
      return map
        .queryRenderedFeatures(undefined, { layers: ["big-cities"] })
        .filter((f: any) => (f.properties?.pop ?? 0) < 5).length;
    });
    expect(belowThreshold, "sub-threshold features rendered — filter fell open").toBe(0);

    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});

test.describe("markers: DOM pins from the markers: block (U5)", () => {
  test("add-a-default-marker: one real DOM marker at the coordinate", async ({ page }) => {
    const errors = await guard(page);
    await openExample(page, "add-a-default-marker", []);
    await expect(page.locator(".maplibregl-marker")).toHaveCount(1);
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("add-custom-icons-with-markers: icon URLs render as img markers", async ({ page }) => {
    const errors = await guard(page);
    await openExample(page, "add-custom-icons-with-markers", []);
    const icons = page.locator("img.maplibregl-marker, .maplibregl-marker img, img[src*='icon-']");
    await expect(icons).toHaveCount(2);
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("attach-a-popup-to-a-marker-instance: clicking the pin toggles its trust-gated popup", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openExample(page, "attach-a-popup-to-a-marker-instance", []);

    const marker = page.locator(".maplibregl-marker");
    await expect(marker).toHaveCount(1);
    await marker.click();

    const popup = page.locator(".maplibregl-popup");
    await expect(popup).toBeVisible();
    await expect(popup.locator("h3")).toHaveText("Hello Copenhagen!");

    await marker.click(); // toggle off — MapLibre's built-in behavior
    await expect(popup).toHaveCount(0);

    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});

test.describe("params panel: parameters: + toggleable: drive the map (U8)", () => {
  const renderedCount = (page: Page, layer: string) =>
    page.evaluate(
      (l) =>
        (document.getElementById("map") as any)
          .getMap()
          .queryRenderedFeatures(undefined, { layers: [l] }).length,
      layer
    );

  test("create-a-time-slider: the range control drives the global-state filter", async ({
    page,
  }) => {
    test.skip(
      !vendorHasGlobalState(),
      `global-state needs maplibre-gl >= 5.6 (vendor is ${VENDOR_MAPLIBRE_VERSION})`
    );
    const errors = await guard(page);
    await openExample(page, "create-a-time-slider", ["cities"]);

    // Default year 1980: two of the five points pass the filter.
    await page.waitForFunction(
      () =>
        (document.getElementById("map") as any)
          .getMap()
          .queryRenderedFeatures(undefined, { layers: ["cities"] }).length === 2
    );

    const slider = page.locator(".ml-map-params input[type=range]");
    await expect(slider).toBeVisible();
    await slider.fill("2020");
    await page.waitForFunction(
      () =>
        (document.getElementById("map") as any)
          .getMap()
          .queryRenderedFeatures(undefined, { layers: ["cities"] }).length === 5
    );
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("filter-layer-symbols: toggles filter categories; the labeled layer gets a visibility checkbox", async ({
    page,
  }) => {
    test.skip(
      !vendorHasGlobalState(),
      `global-state needs maplibre-gl >= 5.6 (vendor is ${VENDOR_MAPLIBRE_VERSION})`
    );
    const errors = await guard(page);
    await openExample(page, "filter-layer-symbols-using-global-state", ["pois"]);
    await page.waitForFunction(
      () =>
        (document.getElementById("map") as any)
          .getMap()
          .queryRenderedFeatures(undefined, { layers: ["pois"] }).length === 4
    );

    // Uncheck "Parks": the two park features filter out.
    const parks = page.locator(".ml-map-params-row", { hasText: "Parks" }).locator("input");
    await parks.setChecked(false);
    await page.waitForFunction(
      () =>
        (document.getElementById("map") as any)
          .getMap()
          .queryRenderedFeatures(undefined, { layers: ["pois"] }).length === 2
    );

    // The layer's authored label put a whole-layer checkbox on the panel.
    const layerToggle = page
      .locator(".ml-map-params-layer", { hasText: "Points of interest" })
      .locator("input");
    await layerToggle.setChecked(false);
    await page.waitForFunction(() => {
      const map = (document.getElementById("map") as any).getMap();
      return map.getLayoutProperty("pois", "visibility") === "none";
    });
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("change-a-layers-color-with-buttons: the select writes global state", async ({
    page,
  }) => {
    test.skip(
      !vendorHasGlobalState(),
      `global-state needs maplibre-gl >= 5.6 (vendor is ${VENDOR_MAPLIBRE_VERSION})`
    );
    const errors = await guard(page);
    await openExample(page, "change-a-layers-color-with-buttons", ["district"]);

    await page.locator(".ml-map-params select").selectOption("1");
    const fill = await page.evaluate(
      () => (document.getElementById("map") as any).getMap().getGlobalState().fill
    );
    expect(fill).toBe("#e63946");
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("below the state floor, the panel degrades to a declared-absence notice", async ({
    page,
  }) => {
    test.skip(
      vendorHasGlobalState(),
      "this leg HAS global state; the notice posture belongs to the v4 leg"
    );
    const errors = await guard(page);
    await openExample(page, "params-declared-absence", ["dot"]);

    await expect(page.locator(".ml-map-params-notice")).toBeVisible();
    await expect(page.locator(".ml-map-params input")).toHaveCount(0);
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});

test.describe("images: declared images register before layers (U6)", () => {
  test("add-an-icon-to-the-map: the image is registered and the symbol renders it", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openExample(page, "add-an-icon-to-the-map", ["logo"]);

    const state = await page.evaluate(() => {
      const map = (document.getElementById("map") as any).getMap();
      return {
        hasImage: map.hasImage("osgeo-logo"),
        rendered: map.queryRenderedFeatures(undefined, { layers: ["logo"] }).length,
      };
    });
    expect(state.hasImage, "images: entry never reached map.addImage").toBe(true);
    expect(state.rendered, "symbol layer rendered nothing").toBeGreaterThan(0);
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("use-a-fallback-image: coalesce falls back; a hard-missing ref warns exactly once", async ({
    page,
  }) => {
    const errors = await guard(page);
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning") warnings.push(message.text());
    });
    await openExample(page, "use-a-fallback-image", ["fallback"]);

    const state = await page.evaluate(() => {
      const map = (document.getElementById("map") as any).getMap();
      return {
        hasFallback: map.hasImage("fallback-marker"),
        rendered: map.queryRenderedFeatures(undefined, { layers: ["fallback"] }).length,
      };
    });
    expect(state.hasFallback).toBe(true);
    expect(state.rendered).toBeGreaterThan(0);
    // A coalesce miss is HANDLED — maplibre never fires styleimagemissing
    // for it, so the document produces no warning at all.
    expect(warnings.filter((w) => w.includes("primary-icon")).length).toBe(0);

    // A hard-missing reference (no coalesce) DOES fire it — and the renderer
    // warns once, not once per render.
    await page.evaluate(() => {
      const map = (document.getElementById("map") as any).getMap();
      map.setLayoutProperty("fallback", "icon-image", "definitely-missing");
    });
    await page.waitForFunction(() =>
      (document.getElementById("map") as any).getMap().isStyleLoaded()
    );
    await page.evaluate(async () => {
      const map = (document.getElementById("map") as any).getMap();
      // Force additional renders — the warning must not repeat.
      map.panBy([30, 0], { duration: 0 });
      map.panBy([-30, 0], { duration: 0 });
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(
      warnings.filter((w) => w.includes('references image "definitely-missing"')).length
    ).toBe(1);
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});

test.describe("touch posture: hover popups don't exist on touch; tap uses click.popup (U7)", () => {
  test.use({ hasTouch: true });

  test("a tap opens the pinned click popup, never the chromeless hover one", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openExample(page, "display-a-popup-on-hover", ["places"]);

    const pt = await page.evaluate(() => {
      const map = (document.getElementById("map") as any).getMap();
      const p = map.project([-77.032, 38.913]);
      const rect = map.getCanvas().getBoundingClientRect();
      return { x: rect.left + p.x, y: rect.top + p.y };
    });
    await page.waitForFunction(
      ({ x, y }) => {
        const map = (document.getElementById("map") as any).getMap();
        const rect = map.getCanvas().getBoundingClientRect();
        return map.queryRenderedFeatures([x - rect.left, y - rect.top], { layers: ["places"] }).length > 0;
      },
      pt,
      { timeout: 30_000 }
    );

    await page.touchscreen.tap(pt.x, pt.y);

    // The popup that opens is the PINNED one (close button present) — the
    // click.popup path, not the chromeless hover preview.
    const popup = page.locator(".maplibregl-popup");
    await expect(popup).toBeVisible();
    await expect(popup.locator(".maplibregl-popup-close-button")).toHaveCount(1);
    await expect(popup.locator("h3")).toHaveText("Washington DC");

    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});
