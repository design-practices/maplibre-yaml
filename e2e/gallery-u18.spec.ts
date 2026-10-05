/**
 * U18 gallery pages — browser verification, which is also the demo.
 *
 * @remarks
 * The last pure-YAML rows of the 0.7 census, plus the font-faces row, each
 * proven on its hermetic twin (examples/gallery/configs/, driven through
 * examples/gallery/viewer.html). Every page here rides a style property
 * newer than the oldest supported peer, so each test skips below the
 * maplibre-gl version that first RENDERS it. The floors were read from the
 * published bundles (npm pack maplibre-gl@x; grep the dist), not guessed:
 *
 * - `hillshade-method: multidirectional` — 5.5.0 (absent from 5.4.0).
 * - `fill-extrusion-rounded-corner-distance` — 6.2.0. 6.1.0's bundled
 *   style-spec already validates the key, but its renderer has no
 *   rounded-corner geometry; 6.2.0 is the first with both.
 * - `symbol-height-offset` — 6.6.0 (absent from 6.5.0).
 * - style-root `font-faces` rendered at runtime (FontFaceManager) — 6.7.0
 *   (absent from 6.6.0; the style-spec's sdk-support table still points
 *   at an issue for js).
 *
 * Each test asserts the property's EFFECT, not just its presence: colored
 * lights in the hillshade, pixels that change with the corner radius,
 * labels that sit above their ground point, labels that can only have been
 * drawn from a font face.
 *
 * The fifth page, fly-to-a-location-based-on-scroll-position, is a
 * scrollytelling document whose runtime is the Astro `<Scrollytelling>`
 * component, so its test drives the BUILT docs page (e2e/server.mjs mounts
 * docs/dist at its path, as for the classics page; `pnpm build` first), with
 * the openfreemap basemap answered by a blank local style.
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { meetsVersion } from "../packages/core/src/capabilities";

/** The vendored maplibre-gl version (the CI matrix overrides it per leg). */
const VENDOR_MAPLIBRE_VERSION: string = JSON.parse(
  readFileSync(join(process.cwd(), "node_modules/maplibre-gl/package.json"), "utf8")
).version;

const MULTIDIRECTIONAL_HILLSHADE_FLOOR = "5.5.0";
const ROUNDED_CORNERS_FLOOR = "6.2.0";
const SYMBOL_HEIGHT_OFFSET_FLOOR = "6.6.0";
const FONT_FACES_FLOOR = "6.7.0";

/** Skip unless the vendor renders a feature introduced in `floor`. */
function requireVendor(floor: string, feature: string): void {
  test.skip(
    !meetsVersion(VENDOR_MAPLIBRE_VERSION, floor),
    `${feature} needs maplibre-gl >= ${floor} (vendor is ${VENDOR_MAPLIBRE_VERSION})`
  );
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

/** Resolve once the map has rendered everything it has asked for. */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const map = (document.getElementById("map") as any).getMap();
      return map.loaded() && map.areTilesLoaded() && !map.isMoving();
    },
    undefined,
    { timeout: 60_000 }
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const map = (document.getElementById("map") as any).getMap();
        map.once("idle", () => resolve());
        map.triggerRepaint();
      })
  );
}

/** Decode a screenshot of the map canvas. */
async function canvasPixels(page: Page): Promise<PNG> {
  return PNG.sync.read(await page.locator("#map canvas.maplibregl-canvas").screenshot());
}

/** How many pixels differ between two same-size screenshots. */
function differingPixels(a: PNG, b: PNG): number {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      a.data[i] !== b.data[i] ||
      a.data[i + 1] !== b.data[i + 1] ||
      a.data[i + 2] !== b.data[i + 2]
    ) {
      n++;
    }
  }
  return n;
}

test.describe("U18 gallery pages (ml-chh.14 + the maplibre-gl 6 rows)", () => {
  test("add-a-multidirectional-hillshade-layer: four colored lights shade the relief", async ({
    page,
  }) => {
    requireVendor(MULTIDIRECTIONAL_HILLSHADE_FLOOR, "multidirectional hillshade");
    const errors = await guard(page);
    await openExample(page, "add-a-multidirectional-hillshade-layer", ["hillshade"]);
    await settled(page);

    const paint = await page.evaluate(() => {
      const map = (document.getElementById("map") as any).getMap();
      return {
        method: map.getPaintProperty("hillshade", "hillshade-method"),
        direction: map.getPaintProperty("hillshade", "hillshade-illumination-direction"),
      };
    });
    expect(paint).toEqual({ method: "multidirectional", direction: [270, 315, 0, 45] });

    // A standard hillshade is grey-on-background. Four colored lights put
    // strongly green, strongly blue and strongly red/magenta slopes on the
    // same screen.
    const png = await canvasPixels(page);
    let green = 0;
    let blue = 0;
    let red = 0;
    for (let i = 0; i < png.data.length; i += 4 * 37) {
      const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]];
      if (g > r + 50 && g > b + 50) green++;
      if (b > r + 50 && b > g + 50) blue++;
      if (r > g + 50 && r > b + 20) red++;
    }
    expect(green, "no green-lit slopes").toBeGreaterThan(50);
    expect(blue, "no blue-shadowed slopes").toBeGreaterThan(50);
    expect(red, "no red/magenta-lit slopes").toBeGreaterThan(50);
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("fill-extrusion-rounded-corners: the corner radius reshapes the buildings; the panel drives height", async ({
    page,
  }) => {
    requireVendor(ROUNDED_CORNERS_FLOOR, "fill-extrusion-rounded-corner-distance");
    const errors = await guard(page);
    await openExample(page, "fill-extrusion-rounded-corners", ["building-extrusion"]);
    await settled(page);
    await page.waitForFunction(
      () =>
        (document.getElementById("map") as any)
          .getMap()
          .queryRenderedFeatures(undefined, { layers: ["building-extrusion"] }).length > 0
    );

    const setRadius = (d: number) =>
      page.evaluate((v) => {
        (document.getElementById("map") as any)
          .getMap()
          .setLayoutProperty("building-extrusion", "fill-extrusion-rounded-corner-distance", v);
      }, d);

    // The document's radius reached the layer...
    expect(
      await page.evaluate(() =>
        (document.getElementById("map") as any)
          .getMap()
          .getLayoutProperty("building-extrusion", "fill-extrusion-rounded-corner-distance")
      )
    ).toBe(2);
    // ...and it is what the buildings are drawn with: square corners
    // (radius 0) render differently, and restoring 2 m restores the image
    // exactly (so the difference is the radius, not render noise).
    const rounded = await canvasPixels(page);
    await setRadius(0);
    await settled(page);
    const square = await canvasPixels(page);
    await setRadius(2);
    await settled(page);
    const roundedAgain = await canvasPixels(page);
    expect(differingPixels(rounded, roundedAgain), "re-rendering at 2 m is not stable").toBe(0);
    expect(differingPixels(rounded, square), "the corner radius changed nothing").toBeGreaterThan(200);

    // The height slider writes global state the extrusion height reads.
    const slider = page
      .locator(".ml-map-params-row", { hasText: "Height multiplier" })
      .locator("input[type=range]");
    await expect(slider).toBeVisible();
    await slider.fill("0");
    await expect
      .poll(() =>
        page.evaluate(() => (document.getElementById("map") as any).getMap().getGlobalState().heightScale)
      )
      .toBe(0);
    await settled(page);
    const flat = await canvasPixels(page);
    expect(differingPixels(rounded, flat), "flattening the buildings changed nothing").toBeGreaterThan(5_000);
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("elevate-symbols-above-the-terrain: each label floats its own height above its ground point", async ({
    page,
  }) => {
    requireVendor(SYMBOL_HEIGHT_OFFSET_FLOOR, "symbol-height-offset");
    const errors = await guard(page);
    await openExample(page, "elevate-symbols-above-the-terrain", ["osm", "balloons"]);
    await settled(page);
    expect(
      await page.evaluate(() => (document.getElementById("map") as any).getMap().getTerrain())
    ).toEqual({ source: "terrainSource", exaggeration: 1 });

    // For each label: project its coordinate onto the terrain, then walk up
    // the screen column above it until the label's placed box is hit. The
    // lift is the screen distance between the two.
    const lifts = await page.evaluate(() => {
      const map = (document.getElementById("map") as any).getMap();
      const points: Array<[string, [number, number]]> = [
        ["0 m", [11.385, 47.276]],
        ["500 m", [11.39, 47.276]],
        ["1500 m", [11.395, 47.276]],
      ];
      const out: Record<string, { atGround: boolean; lift: number | null }> = {};
      for (const [label, lngLat] of points) {
        const p = map.project(lngLat);
        const hit = (y: number) =>
          map
            .queryRenderedFeatures(
              [
                [p.x - 2, y - 2],
                [p.x + 2, y + 2],
              ],
              { layers: ["balloons"] }
            )
            .some((f: any) => f.properties.label === label);
        let lift: number | null = null;
        for (let y = Math.round(p.y); y > p.y - 800; y -= 2) {
          if (hit(y)) {
            lift = p.y - y;
            break;
          }
        }
        out[label] = { atGround: hit(p.y), lift };
      }
      return out;
    });

    expect(lifts["0 m"].atGround, "the 0 m label left its ground point").toBe(true);
    expect(lifts["500 m"].atGround, "the 500 m label sits on the ground").toBe(false);
    expect(lifts["1500 m"].atGround, "the 1500 m label sits on the ground").toBe(false);
    expect(lifts["500 m"].lift).toBeGreaterThan(20);
    expect(lifts["1500 m"].lift).toBeGreaterThan(lifts["500 m"].lift! + 50);
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("style-labels-with-font-faces: Georgian and Armenian labels draw from the font faces", async ({
    page,
  }) => {
    requireVendor(FONT_FACES_FLOOR, "font-faces");
    const errors = await guard(page);
    const fontRequests: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith(".ttf")) fontRequests.push(new URL(r.url()).pathname);
    });
    await openExample(page, "style-labels-with-font-faces", ["satellite", "places"]);
    await settled(page);

    // The twin's glyphs URL serves empty ranges, so a label can only be
    // placed if a font face supplied its glyphs: the four Georgian and
    // Armenian names are, the Latin ones (glyphs-only) are not.
    await expect
      .poll(() =>
        page.evaluate(() =>
          (document.getElementById("map") as any)
            .getMap()
            .queryRenderedFeatures(undefined, { layers: ["places"] })
            .map((f: any) => f.properties.name)
            .sort()
        )
      )
      .toEqual(["ბათუმი", "თბილისი", "Գյումրի", "Երևան"].sort());
    expect(fontRequests.sort()).toEqual([
      "/examples/gallery/fixtures/fonts/NotoSansArmenian-subset.ttf",
      "/examples/gallery/fixtures/fonts/NotoSansGeorgian-subset.ttf",
    ]);
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});

test.describe("U18 scrollytelling page (built docs, <Scrollytelling src>)", () => {
  const SLUG = "fly-to-a-location-based-on-scroll-position";
  const DIST = join(process.cwd(), "docs", "dist");
  const MAP = ".scrollytelling-container ml-map";
  const BLANK_STYLE = {
    version: 8,
    name: "hermetic-blank",
    sources: {},
    layers: [{ id: "background", type: "background", paint: { "background-color": "#dfe7ec" } }],
  };

  // Camera moves are instant under reduced motion (MapLibre honours it):
  // the test proves where the camera lands, not how long the flight takes.
  test.use({ reducedMotion: "reduce" });

  /** Page errors fail the test; the basemap style is stubbed; nothing else leaves the box. */
  async function storyGuard(page: Page): Promise<string[]> {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text()}`);
    });
    await page.route("**/*", (route: Route) => {
      const url = new URL(route.request().url());
      if (/^(localhost|127\.0\.0\.1)$/.test(url.hostname) || /^(data|blob):/.test(url.protocol)) {
        return route.continue();
      }
      if (url.href === "https://tiles.openfreemap.org/styles/bright") {
        return route.fulfill({ json: BLANK_STYLE });
      }
      errors.push(`external request (suite must stay hermetic): ${url.href}`);
      return route.abort();
    });
    return errors;
  }

  const camera = (page: Page) =>
    page.evaluate((sel) => {
      const map = (document.querySelector(sel) as any).getMap();
      const c = map.getCenter();
      return { lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing() };
    }, MAP);

  async function goToChapter(page: Page, id: string): Promise<void> {
    await page.evaluate((chapterId) => {
      document
        .querySelector(`.scrolly-chapter[data-chapter-id="${chapterId}"]`)!
        .scrollIntoView({ block: "center" });
    }, id);
    await expect(page.locator(".scrollytelling-container")).toHaveAttribute("data-active-chapter", id);
  }

  async function expectCamera(
    page: Page,
    want: { lng: number; lat: number; zoom: number; bearing: number }
  ): Promise<void> {
    await expect
      .poll(async () => {
        const c = await camera(page);
        const ok =
          Math.abs(c.lng - want.lng) < 1e-3 &&
          Math.abs(c.lat - want.lat) < 1e-3 &&
          Math.abs(c.zoom - want.zoom) < 0.05 &&
          Math.abs(((c.bearing - want.bearing + 540) % 360) - 180) < 0.5;
        return ok ? "there" : JSON.stringify(c);
      })
      .toBe("there");
  }

  test("fly-to-a-location-based-on-scroll-position: scrolling a chapter into view flies the map to its camera", async ({
    page,
  }) => {
    expect(
      existsSync(join(DIST, "examples", "gallery", SLUG, "index.html")),
      `docs/dist/examples/gallery/${SLUG}/index.html is missing — build the docs first (pnpm build)`
    ).toBe(true);
    const errors = await storyGuard(page);
    await page.goto(`/examples/gallery/${SLUG}/`, { waitUntil: "domcontentloaded" });

    // The runtime fetched and rendered the story document: eight chapters.
    await expect(page.locator(".scrolly-chapter")).toHaveCount(8);
    await page.waitForFunction(
      (sel) => typeof (document.querySelector(sel) as any)?.mapReady === "function",
      MAP,
      { timeout: 60_000 }
    );
    await page.evaluate((sel) => (document.querySelector(sel) as any).mapReady().then(() => null), MAP);
    await expect(page.locator(".scrollytelling-container")).toHaveAttribute("data-active-chapter", "baker");

    await goToChapter(page, "aldgate");
    await expectCamera(page, { lng: -0.07571203, lat: 51.51424049, zoom: 15, bearing: 150 });

    // While the story scrolls, the map sticks just BELOW Starlight's fixed
    // header (GalleryStory.astro), not under it.
    const stick = await page.evaluate(() => ({
      map: document.querySelector(".scrolly-map-container")!.getBoundingClientRect().top,
      header: document.querySelector("header.header")!.getBoundingClientRect().bottom,
    }));
    expect(Math.abs(stick.map - stick.header)).toBeLessThan(2);

    await goToChapter(page, "telegraph");
    await expectCamera(page, { lng: -0.10669358, lat: 51.51433123, zoom: 17.3, bearing: 90 });
    await goToChapter(page, "charing-cross");
    await expectCamera(page, { lng: -0.12416858, lat: 51.50779757, zoom: 14.3, bearing: 90 });
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});
