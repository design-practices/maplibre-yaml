/**
 * U16 YAML + JavaScript gallery pages — browser verification, which is also the demo.
 *
 * @remarks
 * Every page here pairs a YAML document with a few lines of page JS (and,
 * where it has controls, a page-chrome fragment that rides `<ml-map>`'s
 * corner slots). The twin harness (`examples/gallery/hatch/twin.html`)
 * injects THE SAME chrome file and runs THE SAME JS file the docs page
 * ships, against a hermetic config — so the code a reader copies is the
 * code these tests drive. Each test asserts the hatch's BEHAVIOUR: the
 * camera lands, the padding moves, the handler switches off, the icon
 * exists, the protocol rewrote the data — not merely that a map appeared.
 */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { meetsVersion, STATE_RUNTIME_FLOOR } from "../packages/core/src/capabilities";

/**
 * The maplibre-gl version the e2e vendor serves (root devDependency — the
 * CI matrix overrides it per leg, e.g. ^4.7.1). A few pages exercise
 * runtime features newer than the oldest supported peer; those tests skip
 * below the version that introduced the feature (the docs site runs 5.x).
 */
const VENDOR_MAPLIBRE_VERSION: string = JSON.parse(
  readFileSync(join(process.cwd(), "node_modules/maplibre-gl/package.json"), "utf8")
).version;

/**
 * Labels without a `glyphs` URL: before 5.11.0 the GlyphManager threw
 * "glyphsUrl is not set"; from 5.11.0 it rasterizes every glyph locally
 * (checked against the published 5.10.0 / 5.11.0 bundles).
 */
const LOCAL_GLYPHS_FLOOR = "5.11.0";

/** Fail the test on any page error or off-origin request (hermeticity). */
async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (
      /^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) ||
      url.startsWith("data:") ||
      url.startsWith("blob:")
    ) {
      return route.continue();
    }
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return errors;
}

/** Open a twin and wait for the style plus the named document layers. */
async function openHatch(page: Page, slug: string, layers: string[] = []): Promise<void> {
  await page.goto(`/examples/gallery/hatch/twin.html?slug=${slug}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    (ids) => {
      const map = (document.getElementById("map") as any)?.getMap?.();
      // Not isStyleLoaded(): a hatch that writes a source every frame
      // (updateData, setData loops) keeps that false indefinitely. The
      // map's `load` having fired plus the layers existing is the signal.
      if (!map || !(map as any)._loaded) return false;
      return ids.every((id: string) => Boolean(map.getLayer?.(id)));
    },
    layers,
    { timeout: 60_000 }
  );
}

/** Wait until slot chrome has been mounted into a map corner (U9: on load). */
async function chromeMounted(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (sel) => document.querySelector(`[class*="ml-map-chrome-"] ${sel}`) !== null,
    selector,
    { timeout: 30_000 }
  );
}

const evalMap = <T>(page: Page, fn: (map: any) => T) =>
  page.evaluate(`(${fn.toString()})(document.getElementById("map").getMap())`) as Promise<T>;

/** Rendered features of one layer, as plain coordinates arrays. */
const rendered = (page: Page, layerId: string) =>
  page.evaluate(
    (id) =>
      (document.getElementById("map") as any)
        .getMap()
        .queryRenderedFeatures(undefined, { layers: [id] })
        .map((f: any) => ({ geometry: f.geometry, properties: f.properties })),
    layerId
  );

const near = (a: number, b: number, tol: number) => Math.abs(a - b) < tol;

test.describe("U16 camera & animation hatches", () => {
  test("jump-to-a-series-of-locations: the timer tour jumps to the next city", async ({ page }) => {
    const errors = await guard(page);
    await openHatch(page, "jump-to-a-series-of-locations", ["cities"]);
    await chromeMounted(page, "[data-city]");

    // 2 s after load the tour jumps (no animation) to Chiang Mai.
    await page.waitForFunction(
      () => {
        const c = (document.getElementById("map") as any).getMap().getCenter();
        return Math.abs(c.lng - 98.993) < 0.01 && Math.abs(c.lat - 18.793) < 0.01;
      },
      undefined,
      { timeout: 10_000 }
    );
    await expect(page.locator("[data-city]")).toContainText("Chiang Mai");
    expect(errors).toEqual([]);
  });

  test("slowly-fly-to-a-location: the slot button starts a slow, zoomed-out flight east", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openHatch(page, "slowly-fly-to-a-location");
    await chromeMounted(page, "[data-fly-toggle]");

    await page.click("[data-fly-toggle]");
    // curve: 1 zooms well out before panning; speed: 0.2 keeps it in the air.
    await page.waitForFunction(
      () => {
        const map = (document.getElementById("map") as any).getMap();
        return map.isMoving() && map.getZoom() < 7 && map.getCenter().lng > -74;
      },
      undefined,
      { timeout: 15_000 }
    );
    expect(errors).toEqual([]);
  });

  test("animate-a-line: updateLayerData grows the line, and Pause stops it", async ({ page }) => {
    const errors = await guard(page);
    await openHatch(page, "animate-a-line", ["line-animation"]);
    await chromeMounted(page, "[data-pause]");

    const eastmost = async () => {
      const feats = await rendered(page, "line-animation");
      const xs = feats.flatMap((f: any) =>
        (f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates)
          .flat()
          .map((p: number[]) => p[0])
      );
      return xs.length ? Math.max(...xs) : -Infinity;
    };
    await page.waitForFunction(
      () =>
        (document.getElementById("map") as any)
          .getMap()
          .queryRenderedFeatures(undefined, { layers: ["line-animation"] }).length > 0
    );
    const a = await eastmost();
    await page.waitForTimeout(1500);
    const b = await eastmost();
    expect(b).toBeGreaterThan(a); // ~1.5 s at 30 frames/degree ≈ +50°

    await page.click("[data-pause]");
    await expect(page.locator("[data-pause]")).toHaveText("Play");
    await page.waitForTimeout(300);
    const c = await eastmost();
    await page.waitForTimeout(1000);
    expect(await eastmost()).toBe(c);
    expect(errors).toEqual([]);
  });

  test("animate-a-point-along-a-route: the plane flies the arc, rotated, and Replay rewinds", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openHatch(page, "animate-a-point-along-a-route", ["route", "plane"]);
    await chromeMounted(page, "[data-replay]");
    expect(await evalMap(page, (map) => map.hasImage("plane"))).toBe(true);

    const plane = async () => (await rendered(page, "plane"))[0] ?? null;
    await page.waitForFunction(
      () => {
        const f = (document.getElementById("map") as any)
          .getMap()
          .queryRenderedFeatures(undefined, { layers: ["plane"] })[0];
        return f && f.geometry.coordinates[0] > -100;
      },
      undefined,
      { timeout: 30_000 }
    );
    const mid = await plane();
    // The arc is a great circle: mid-route the plane is NORTH of the straight
    // line between the endpoints (both near 38°N), heading east.
    expect(mid.geometry.coordinates[1]).toBeGreaterThan(39);
    expect(mid.properties.bearing).toBeGreaterThan(45);
    expect(mid.properties.bearing).toBeLessThan(135);

    await page.click("[data-replay]");
    await page.waitForFunction(
      () => {
        const f = (document.getElementById("map") as any)
          .getMap()
          .queryRenderedFeatures(undefined, { layers: ["plane"] })[0];
        return f && f.geometry.coordinates[0] < -115;
      },
      undefined,
      { timeout: 10_000 }
    );
    expect(errors).toEqual([]);
  });

  test("animate-map-camera-around-a-point: the rAF loop turns the bearing", async ({ page }) => {
    const errors = await guard(page);
    await openHatch(page, "animate-map-camera-around-a-point");
    const a = await evalMap(page, (map) => map.getBearing());
    await page.waitForTimeout(800);
    const b = await evalMap(page, (map) => map.getBearing());
    expect(Math.abs(b - a)).toBeGreaterThan(2); // ~10°/s
    expect(await evalMap(page, (map) => map.getPitch())).toBe(45);
    expect(errors).toEqual([]);
  });

  test("customize-camera-animations: offset and animate options reach flyTo", async ({ page }) => {
    const errors = await guard(page);
    await openHatch(page, "customize-camera-animations", ["target-circle", "target-label"]);
    await chromeMounted(page, "[data-animate]");

    // Instant move, no offset: the camera centres on the new target.
    await page.locator('[name="animate"]').uncheck();
    await page.click("[data-animate]");
    await page.waitForFunction(() => {
      const map = (document.getElementById("map") as any).getMap();
      const f = map.queryRenderedFeatures(undefined, { layers: ["target-circle"] })[0];
      if (!f) return false;
      const [lng, lat] = f.geometry.coordinates;
      const c = map.getCenter();
      return Math.abs(c.lng - lng) < 0.05 && Math.abs(c.lat - lat) < 0.05 && (lng !== -94 || lat !== 40);
    });

    // A 100 px x-offset: the target lands 100 px right of the viewport centre.
    await page.locator('[name="offset-x"]').fill("100");
    await page.click("[data-animate]");
    await page.waitForFunction(() => {
      const map = (document.getElementById("map") as any).getMap();
      const f = map.queryRenderedFeatures(undefined, { layers: ["target-circle"] })[0];
      if (!f) return false;
      const p = map.project(f.geometry.coordinates);
      const w = map.getCanvas().clientWidth;
      const h = map.getCanvas().clientHeight;
      return Math.abs(p.x - (w / 2 + 100)) < 3 && Math.abs(p.y - h / 2) < 3;
    });
    // The shared source carries the label the symbol layer reads (glyphs
    // are empty hermetically, so read it off the circle layer).
    const label = await rendered(page, "target-circle");
    expect(label[0].properties.label).toMatch(/^Center: \[-?\d+\.\d, -?\d+\.\d\]$/);
    expect(errors).toEqual([]);
  });

  test("offset-the-vanishing-point-using-padding: sidebar toggles ease the camera padding", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openHatch(page, "offset-the-vanishing-point-using-padding");
    await chromeMounted(page, '[data-sidebar="right"]');
    const padding = () => evalMap(page, (map) => map.getPadding());

    // Upstream opens the left sidebar on load.
    await expect.poll(async () => (await padding()).left, { timeout: 10_000 }).toBe(300);
    await page.click('[data-sidebar-toggle="right"]');
    await expect.poll(async () => (await padding()).right, { timeout: 10_000 }).toBe(300);
    await page.click('[data-sidebar-toggle="left"]');
    await expect.poll(async () => (await padding()).left, { timeout: 10_000 }).toBe(0);
    expect(await page.locator('[data-sidebar="right"]').getAttribute("class")).toContain("open");
    // The YAML marker sits on the centre point.
    expect(await page.locator(".maplibregl-marker").count()).toBe(1);
    expect(errors).toEqual([]);
  });

  test("toggle-interactions: unchecking a box disables that handler", async ({ page }) => {
    const errors = await guard(page);
    await openHatch(page, "toggle-interactions");
    await chromeMounted(page, "[data-interactions]");

    for (const handler of ["scrollZoom", "dragPan", "keyboard"]) {
      expect(await page.evaluate((h) => (document.getElementById("map") as any).getMap()[h].isEnabled(), handler)).toBe(true);
      await page.locator(`[name="${handler}"]`).uncheck();
      await expect
        .poll(() => page.evaluate((h) => (document.getElementById("map") as any).getMap()[h].isEnabled(), handler))
        .toBe(false);
    }
    await page.locator('[name="scrollZoom"]').check();
    await expect
      .poll(() => evalMap(page, (map) => map.scrollZoom.isEnabled()))
      .toBe(true);

    // And the switch is real: with scroll zoom off, the wheel does nothing.
    await page.locator('[name="scrollZoom"]').uncheck();
    const z0 = await evalMap(page, (map) => map.getZoom());
    const box = (await page.locator("#map canvas").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(500);
    expect(await evalMap(page, (map) => map.getZoom())).toBe(z0);
    expect(errors).toEqual([]);
  });
});

test.describe("U16 event hatches", () => {
  test("get-coordinates-of-the-mouse-pointer: mousemove writes point and lngLat to the slot panel", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openHatch(page, "get-coordinates-of-the-mouse-pointer");
    await chromeMounted(page, "[data-pointer-info]");

    const target = await page.evaluate(() => {
      const map = (document.getElementById("map") as any).getMap();
      const p = map.project([-80, 35]);
      const rect = map.getCanvas().getBoundingClientRect();
      return { x: rect.left + p.x, y: rect.top + p.y, px: p.x, py: p.y };
    });
    await page.mouse.move(target.x, target.y);
    const text = await page.locator("[data-pointer-info]").innerText();
    const [point, lngLat] = text.split("\n").map((l) => JSON.parse(l));
    expect(near(point.x, target.px, 2)).toBe(true);
    expect(near(point.y, target.py, 2)).toBe(true);
    expect(near(lngLat.lng, -80, 0.2)).toBe(true);
    expect(near(lngLat.lat, 35, 0.2)).toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe("U16 source & data hatches", () => {
  test("add-a-canvas-source: page JS adds an animated canvas source under the YAML map", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openHatch(page, "add-a-canvas-source");
    await page.waitForFunction(
      () => Boolean((document.getElementById("map") as any).getMap().getLayer("canvas-layer"))
    );
    const source = await evalMap(page, (map) => {
      const s = map.getSource("canvas-source");
      return {
        // CanvasSource reports type "image" (it subclasses ImageSource);
        // what identifies it is the very <canvas> the page draws on.
        drawsPageCanvas: s.canvas === document.querySelector("[data-canvas-source]"),
        animate: s.animate,
        coords: s.coordinates,
      };
    });
    expect(source.drawsPageCanvas).toBe(true);
    expect(source.animate).toBe(true);
    expect(source.coords[0]).toEqual([91.4461, 21.5006]);

    // The canvas MapLibre drapes is being redrawn frame to frame.
    const snapshot = () =>
      page.evaluate(() =>
        (document.querySelector("[data-canvas-source]") as HTMLCanvasElement).toDataURL()
      );
    const a = await snapshot();
    await page.waitForTimeout(300);
    expect(await snapshot()).not.toBe(a);
    expect(errors).toEqual([]);
  });

  test("animate-a-series-of-images: updateImage cycles the image source's frames", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openHatch(page, "animate-a-series-of-images", ["radar-layer"]);
    const seen = new Set<string>();
    for (let i = 0; i < 12 && seen.size < 3; i++) {
      seen.add(
        await evalMap(page, (map) => map.getSource(map.getLayer("radar-layer").source).url)
      );
      await page.waitForTimeout(150);
    }
    expect([...seen].every((u) => /\/gallery-assets\/radar[0-4]\.gif$/.test(u))).toBe(true);
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect(errors).toEqual([]);
  });

  test("update-geojson-polygons: updateData moves features by id", async ({ page }) => {
    const errors = await guard(page);
    await openHatch(page, "update-geojson-polygons", ["rectangles", "rectangles-label"]);
    await page.waitForFunction(
      () =>
        (document.getElementById("map") as any)
          .getMap()
          .queryRenderedFeatures(undefined, { layers: ["rectangles"] }).length >= 5
    );
    const firstVertex = async () => {
      const feats = await rendered(page, "rectangles");
      return JSON.stringify(feats.map((f: any) => f.geometry.coordinates[0][0]).sort());
    };
    const a = await firstVertex();
    await page.waitForTimeout(500);
    expect(await firstVertex()).not.toBe(a);
    expect(await evalMap(page, (map) => map.showTileBoundaries)).toBe(true);
    expect(errors).toEqual([]);
  });

  test("draw-a-circle: computed polygon fills the YAML layers; the slider resizes it", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openHatch(page, "draw-a-circle", ["location-radius", "location-radius-outline"]);
    await chromeMounted(page, "[data-radius]");

    // Half-width of the polygon's bbox, in km at this latitude.
    // qRF returns the polygon in tile-clipped pieces: measure them all.
    const radiusKm = () =>
      page.evaluate(() => {
        const map = (document.getElementById("map") as any).getMap();
        const feats = map.queryRenderedFeatures(undefined, { layers: ["location-radius"] });
        if (!feats.length) return 0;
        const lngs = feats.flatMap((f: any) =>
          f.geometry.coordinates.flat(2).filter((_: number, i: number) => i % 2 === 0)
        );
        const half = (Math.max(...lngs) - Math.min(...lngs)) / 2;
        return half * 111.32 * Math.cos((48.8452 * Math.PI) / 180);
      });
    await expect.poll(radiusKm, { timeout: 15_000 }).toBeGreaterThan(0.95);
    expect(await radiusKm()).toBeLessThan(1.05);

    await page.locator("[data-radius]").fill("2");
    await expect.poll(radiusKm).toBeGreaterThan(1.9);
    await expect(page.locator("[data-radius-readout]")).toHaveText("2.0 km");
    expect(errors).toEqual([]);
  });
});

test.describe("U16 image & icon hatches", () => {
  test("add-a-generated-icon-to-the-map: raw pixels become an icon, then the layer shows", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openHatch(page, "add-a-generated-icon-to-the-map", ["points"]);
    await page.waitForFunction(
      () =>
        (document.getElementById("map") as any)
          .getMap()
          .queryRenderedFeatures(undefined, { layers: ["points"] }).length === 1
    );
    expect(await evalMap(page, (map) => map.hasImage("gradient"))).toBe(true);
    expect(await evalMap(page, (map) => map.getLayoutProperty("points", "visibility"))).toBe(
      "visible"
    );
    expect(errors).toEqual([]);
  });

  test("add-an-animated-icon-to-the-map: the StyleImageInterface keeps the map repainting", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openHatch(page, "add-an-animated-icon-to-the-map", ["points"]);
    await page.waitForFunction(
      () =>
        (document.getElementById("map") as any)
          .getMap()
          .queryRenderedFeatures(undefined, { layers: ["points"] }).length === 1
    );
    // render() calls triggerRepaint: frames keep arriving with no input.
    const frames = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const map = (document.getElementById("map") as any).getMap();
          let n = 0;
          const count = () => n++;
          map.on("render", count);
          setTimeout(() => {
            map.off("render", count);
            resolve(n);
          }, 1000);
        })
    );
    expect(frames).toBeGreaterThan(5);
    expect(errors).toEqual([]);
  });

  test("add-a-stretchable-image-to-the-map: images register with their stretch zones", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openHatch(page, "add-a-stretchable-image-to-the-map", ["points", "original"]);
    await page.waitForFunction(
      () => (document.getElementById("map") as any).getMap().hasImage("popup"),
      undefined,
      { timeout: 20_000 }
    );
    const meta = await evalMap(page, (map) => {
      // style.getImage is internal; the public API has no options getter.
      const img = map.style.getImage("popup-debug");
      return {
        stretchX: img.stretchX,
        stretchY: img.stretchY,
        content: img.content,
        pixelRatio: img.pixelRatio,
      };
    });
    expect(meta).toEqual({
      stretchX: [
        [25, 55],
        [85, 115],
      ],
      stretchY: [[25, 100]],
      content: [25, 25, 115, 100],
      pixelRatio: 2,
    });
    await expect
      .poll(() => evalMap(page, (map) => map.getLayoutProperty("original", "visibility")))
      .toBe("visible");
    expect(errors).toEqual([]);
  });

  test("generate-and-add-a-missing-icon-to-the-map: the page paints missing icons on demand (resolver on v6, event on 4/5), with no warning", async ({
    page,
  }) => {
    const errors = await guard(page);
    const warnings: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "warning") warnings.push(m.text());
    });
    await openHatch(page, "generate-and-add-a-missing-icon-to-the-map", ["points"]);
    await page.waitForFunction(
      () =>
        (document.getElementById("map") as any)
          .getMap()
          .queryRenderedFeatures(undefined, { layers: ["points"] }).length === 3
    );
    for (const id of ["square-rgb-255,0,0", "square-rgb-255,209,28", "square-rgb-242,127,32"]) {
      expect(
        await page.evaluate((i) => (document.getElementById("map") as any).getMap().hasImage(i), id)
      ).toBe(true);
    }
    // The renderer's missing-image warning defers to a page handler that
    // supplied the image — no false "no addImage call supplies it".
    expect(warnings.filter((w) => w.includes("square-rgb-"))).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe("U16 label, language & filter hatches", () => {
  test("style-labels-with-local-fonts: no glyphs URL, labels still place from local fonts", async ({
    page,
  }) => {
    test.skip(
      !meetsVersion(VENDOR_MAPLIBRE_VERSION, LOCAL_GLYPHS_FLOOR),
      `labels with no glyphs URL need maplibre-gl >= ${LOCAL_GLYPHS_FLOOR} (vendor is ${VENDOR_MAPLIBRE_VERSION})`
    );
    const errors = await guard(page);
    await openHatch(page, "style-labels-with-local-fonts", ["places"]);
    expect(await evalMap(page, (map) => map.getStyle().glyphs ?? null)).toBeNull();
    // With no glyph server, MapLibre rasterizes the text itself, so the
    // labels place (the empty-glyph twins elsewhere place none).
    await page.waitForFunction(
      () =>
        (document.getElementById("map") as any)
          .getMap()
          .queryRenderedFeatures(undefined, { layers: ["places"] }).length === 2
    );
    expect(errors).toEqual([]);
  });

  test("filter-symbols-by-text-input: typing writes global state and the filter follows", async ({
    page,
  }) => {
    test.skip(
      !meetsVersion(VENDOR_MAPLIBRE_VERSION, STATE_RUNTIME_FLOOR),
      `global-state filters need maplibre-gl >= ${STATE_RUNTIME_FLOOR} (vendor is ${VENDOR_MAPLIBRE_VERSION})`
    );
    const errors = await guard(page);
    await openHatch(page, "filter-symbols-by-text-input", ["poi"]);
    await chromeMounted(page, "[data-filter-input]");
    const count = () =>
      page.evaluate(
        () =>
          (document.getElementById("map") as any)
            .getMap()
            .queryRenderedFeatures(undefined, { layers: ["poi"] }).length
      );
    await expect.poll(count, { timeout: 15_000 }).toBe(7);
    await page.locator("[data-filter-input]").fill("MUS");
    await expect.poll(count).toBe(3); // three music venues; input is lowercased
    expect(await evalMap(page, (map) => map.getGlobalState().query)).toBe("mus");
    await page.locator("[data-filter-input]").fill("th");
    await expect.poll(count).toBe(2); // only "theatre" contains "th"
    await page.locator("[data-filter-input]").fill("");
    await expect.poll(count).toBe(7);
    expect(errors).toEqual([]);
  });

  test("change-a-maps-language: buttons point the basemap's label layers at name:<lang>", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openHatch(page, "change-a-maps-language");
    await chromeMounted(page, "[data-lang]");
    const field = () =>
      evalMap(page, (map) => JSON.stringify(map.getLayoutProperty("label_country_1", "text-field")));
    await page.click('[data-lang="fr"]');
    await expect
      .poll(field)
      .toBe(JSON.stringify(["coalesce", ["get", "name:fr"], ["get", "name"]]));
    await page.click('[data-lang="de"]');
    await expect.poll(field).toContain("name:de");
    expect(errors).toEqual([]);
  });
});

test.describe("U16 protocol & plugin hatches", () => {
  test("use-addprotocol-to-transform-feature-properties: the protocol rewrites properties in flight", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openHatch(page, "use-addprotocol-to-transform-feature-properties", [
      "country-points",
      "country-names",
    ]);
    await page.waitForFunction(
      () =>
        (document.getElementById("map") as any)
          .getMap()
          .queryRenderedFeatures(undefined, { layers: ["country-points"] }).length === 7,
      undefined,
      { timeout: 20_000 }
    );
    const names = (await rendered(page, "country-points")).map((f: any) => f.properties.NAME);
    expect(names).toContain("dnalreztiwS");
    expect(names).toContain("airtsuA");
    expect(names).not.toContain("Switzerland");
    expect(errors).toEqual([]);
  });

  test("add-contour-lines: maplibre-contour serves contours:// tiles computed from the YAML's DEM", async ({
    page,
  }) => {
    const errors = await guard(page);
    await openHatch(page, "add-contour-lines", ["hills", "contours", "contour-text"]);
    await page.waitForFunction(
      () =>
        (document.getElementById("map") as any)
          .getMap()
          .queryRenderedFeatures(undefined, { layers: ["contours"] }).length > 0,
      undefined,
      { timeout: 45_000 }
    );
    const feats = await rendered(page, "contours");
    expect(feats.every((f: any) => typeof f.properties.ele === "number")).toBe(true);
    expect(feats.some((f: any) => f.properties.level === 1)).toBe(true); // a major line
    expect(errors).toEqual([]);
  });
});
