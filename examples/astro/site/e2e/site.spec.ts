/**
 * The Astro example site, driven in a real browser.
 *
 * @remarks
 * Run by `scripts/astro-matrix.mjs` once per supported Astro major, against
 * `astro preview` (everything) and `astro dev` (the `@dev` smoke tests).
 * Each test asserts behaviour a reader of the docs relies on -- a map that
 * renders, buttons that move the camera, scrolling that changes chapters, a
 * collection that becomes pages -- and fails on any console error.
 *
 * Hermetic: the basemap style URL is answered with a blank local style and
 * every other off-origin request fails the test, so no tile server can turn
 * CI red. (Run with ASTRO_SITE_LIVE_TILES=1 to let the real basemap load.)
 */
import { test, expect, type Page } from "@playwright/test";

const LIVE = process.env.ASTRO_SITE_LIVE_TILES === "1";

const BLANK_STYLE = {
  version: 8,
  name: "hermetic-blank",
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#dfe7ec" } }],
};

/** Collect page errors; stub the basemap; fail any other external request. */
async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  if (!LIVE) {
    await page.route(
      (url) => !["localhost", "127.0.0.1"].includes(url.hostname),
      (route) => {
        const url = route.request().url();
        if (url.startsWith("https://tiles.openfreemap.org/styles/")) {
          return route.fulfill({ json: BLANK_STYLE });
        }
        errors.push(`external request (suite must stay hermetic): ${url}`);
        return route.abort();
      }
    );
  }
  return errors;
}

/** Wait for the `<ml-map>` matched by `selector` to finish loading. */
async function mapReady(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (sel) => typeof (document.querySelector(sel) as any)?.mapReady === "function",
    selector,
    { timeout: 120_000 }
  );
  await page.evaluate((sel) => (document.querySelector(sel) as any).mapReady().then(() => null), selector);
}

/** Wait until the map's GeoJSON source behind `layer` has features. */
async function layerLoaded(page: Page, selector: string, layer: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          ([sel, id]) => {
            const map = (document.querySelector(sel) as any).getMap();
            const l = map.getLayer(id);
            return l ? map.querySourceFeatures(l.source).length : -1;
          },
          [selector, layer] as const
        ),
      { message: `layer ${layer} has features` }
    )
    .toBeGreaterThan(0);
}

interface Camera {
  lng: number;
  lat: number;
  zoom: number;
}

const camera = (page: Page, selector: string): Promise<Camera> =>
  page.evaluate((sel) => {
    const map = (document.querySelector(sel) as any).getMap();
    const c = map.getCenter().wrap();
    return { lng: c.lng, lat: c.lat, zoom: map.getZoom() };
  }, selector);

/** Poll until the camera is within `tol` degrees of [lng, lat] (and zoom, if given). */
async function expectCameraNear(
  page: Page,
  selector: string,
  [lng, lat]: [number, number],
  zoom?: number,
  tol = 1.5
): Promise<void> {
  await expect
    .poll(
      async () => {
        const c = await camera(page, selector);
        const dLng = Math.abs(((c.lng - lng + 540) % 360) - 180);
        const ok = dLng < tol && Math.abs(c.lat - lat) < tol && (zoom === undefined || Math.abs(c.zoom - zoom) < 0.3);
        return ok ? "near" : JSON.stringify(c);
      },
      { message: `camera near [${lng}, ${lat}]${zoom === undefined ? "" : ` z${zoom}`}` }
    )
    .toBe("near");
}

/** Scroll a story chapter into the activation band and wait for it to activate. */
async function goToChapter(page: Page, id: string): Promise<void> {
  await page.evaluate((chapterId) => {
    document
      .querySelector(`.scrolly-chapter[data-chapter-id="${chapterId}"]`)!
      .scrollIntoView({ block: "center" });
  }, id);
  await expect(page.locator(".scrollytelling-container")).toHaveAttribute("data-active-chapter", id);
}

// Camera animations are instant under reduced motion (MapLibre honours it),
// which keeps the suite fast without changing what it proves: the camera
// moves to where the document says.
test.use({ reducedMotion: "reduce" });

test.describe("home: <Map config> and <Map src>", () => {
  test("both maps render, and corner slots land in <ml-map>'s corners @dev", async ({ page }) => {
    const errors = await guard(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const hero = '[data-testid="hero-map"] ml-map';
    const runtime = '[data-testid="runtime-map"] ml-map';
    await mapReady(page, hero);
    await layerLoaded(page, hero, "volcanoes");
    await mapReady(page, runtime);
    await layerLoaded(page, runtime, "volcanoes");

    // <Map src> really fetched its own document: the camera is the YAML's.
    await expectCameraNear(page, runtime, [136.5, 34], 4.3, 0.2);

    // Slot forwarding (ml-l4y.3): the captions are inside the map's corners.
    await expect(page.locator(`${hero} .ml-map-chrome-top-left [data-testid="hero-caption"]`)).toBeVisible();
    await expect(page.locator(`${hero} .ml-map-chrome-bottom-right a[href="/explore"]`)).toBeVisible();
    const map = await page.locator(hero).boundingBox();
    const cap = await page.locator('[data-testid="hero-caption"]').boundingBox();
    expect(cap!.x).toBeGreaterThanOrEqual(map!.x);
    expect(cap!.y).toBeGreaterThanOrEqual(map!.y);
    expect(cap!.y + cap!.height).toBeLessThanOrEqual(map!.y + map!.height);

    expect(errors).toEqual([]);
  });
});

test.describe("explore: <FullPageMap> with the 0.7 surface", () => {
  const MAP = ".ml-fullpage-map ml-map";

  test("zoom and reset buttons move the camera @dev", async ({ page }) => {
    const errors = await guard(page);
    await page.goto("/explore/", { waitUntil: "domcontentloaded" });
    await mapReady(page, MAP);
    const home = await camera(page, MAP);

    await page.click('[data-action="zoom-in"]');
    await expect.poll(async () => (await camera(page, MAP)).zoom).toBeCloseTo(home.zoom + 1, 1);
    await page.click('[data-action="zoom-in"]');
    await expect.poll(async () => (await camera(page, MAP)).zoom).toBeCloseTo(home.zoom + 2, 1);
    await page.click('[data-action="zoom-out"]');
    await expect.poll(async () => (await camera(page, MAP)).zoom).toBeCloseTo(home.zoom + 1, 1);

    await page.click('[data-action="reset"]');
    await expectCameraNear(page, MAP, [home.lng, home.lat], home.zoom, 0.5);
    expect(errors).toEqual([]);
  });

  test("legend, markers, params panel, hover popup and the slotted caption", async ({ page }) => {
    const errors = await guard(page);
    await page.goto("/explore/", { waitUntil: "domcontentloaded" });
    await mapReady(page, MAP);
    await layerLoaded(page, MAP, "volcanoes-active");
    await layerLoaded(page, MAP, "ring");

    // showLegend: core's legend, built from the layers' `legend:` fields.
    const legend = page.locator(`${MAP} .ml-map-legend`);
    await expect(legend).toContainText("Active volcano");
    await expect(legend).toContainText("Dormant volcano");
    await expect(legend).toContainText("Plate boundary");

    // markers: three landmark-eruption pins.
    await expect(page.locator(`${MAP} .maplibregl-marker`)).toHaveCount(3);

    // Slot forwarding through FullPageMap.
    await expect(page.locator(`${MAP} .ml-map-chrome-top-left [data-testid="explore-caption"]`)).toBeVisible();

    // parameters: the toggle drives global-state, which filters the ring layer.
    const ringRendered = () =>
      page.evaluate((sel) => {
        const map = (document.querySelector(sel) as any).getMap();
        return map.queryRenderedFeatures({ layers: ["ring"] }).length;
      }, MAP);
    await expect.poll(ringRendered).toBeGreaterThan(0);
    const toggle = page.locator(`${MAP} .ml-map-params-row`, { hasText: "Plate boundaries" }).locator("input");
    await toggle.click();
    await expect.poll(ringRendered).toBe(0);
    await toggle.click();
    await expect.poll(ringRendered).toBeGreaterThan(0);

    // interactive.hover: a popup over Popocatépetl.
    const point = await page.evaluate((sel) => {
      const el = document.querySelector(sel) as any;
      const p = el.getMap().project([-98.6278, 19.0225]);
      const box = el.getBoundingClientRect();
      return { x: box.left + p.x, y: box.top + p.y };
    }, MAP);
    await page.mouse.move(point.x, point.y);
    await expect(page.locator(".maplibregl-popup")).toContainText("Popocatépetl");

    expect(errors).toEqual([]);
  });
});

test.describe("story: <Scrollytelling config>", () => {
  const MAP = ".scrollytelling-container ml-map";

  test("scrolling changes chapters, the camera, layers and runs every action kind", async ({ page }) => {
    const errors = await guard(page);
    await page.goto("/story/", { waitUntil: "domcontentloaded" });
    await mapReady(page, MAP);
    await layerLoaded(page, MAP, "volcanoes");
    await expect(page.locator(".scrollytelling-container")).toHaveAttribute("data-active-chapter", "pacific");

    const map = <T,>(fn: string) =>
      page.evaluate(
        ([sel, body]) => new Function("map", `return (${body})`)((document.querySelector(sel) as any).getMap()),
        [MAP, fn] as const
      ) as Promise<T>;

    // layers.show
    expect(await map<string>(`map.getLayoutProperty("ring", "visibility")`)).toBe("none");
    await goToChapter(page, "boundaries");
    await expect.poll(() => map<string>(`map.getLayoutProperty("ring", "visibility")`)).toBe("visible");

    // camera + onChapterEnter setFilter
    await goToChapter(page, "japan");
    await expectCameraNear(page, MAP, [135, 34], 4.6);
    expect(await map(`map.getFilter("spotlight")`)).toEqual(["==", ["get", "country"], "Japan"]);

    // onChapterExit (japan) + setPaintProperty (cascades)
    await goToChapter(page, "cascades");
    await expectCameraNear(page, MAP, [-122, 46.5], 6.3);
    expect(await map(`map.getFilter("spotlight")`)).toEqual(["==", ["get", "country"], "none"]);
    expect(await map(`map.getPaintProperty("volcanoes", "circle-color")`)).toBe("#ffd166");

    // fitBounds action frames the Andes
    await goToChapter(page, "andes");
    await expectCameraNear(page, MAP, [-74, -19.5], undefined, 3);

    // custom action -> page event -> banner
    await goToChapter(page, "tonga");
    await expect(page.locator("#story-banner")).toHaveText("Pressure wave circled the globe four times");

    // flyTo action overrides the chapter camera; layers.hide
    await goToChapter(page, "home");
    await expectCameraNear(page, MAP, [-165, 12], 1.3, 3);
    await expect.poll(() => map<string>(`map.getLayoutProperty("spotlight", "visibility")`)).toBe("none");

    // The chapter rail follows the active chapter.
    await expect(page.locator(".chapter-marker.active")).toHaveAttribute("data-chapter-id", "home");
    expect(errors).toEqual([]);
  });
});

test.describe("runtime story: <Scrollytelling src> (ml-euv)", () => {
  const MAP = ".scrollytelling-container ml-map";

  test("loads, renders styled chapters, and drives the camera @dev", async ({ page }) => {
    const errors = await guard(page);
    await page.goto("/story-runtime/", { waitUntil: "domcontentloaded" });

    await expect(page.locator(".scrolly-chapter")).toHaveCount(3);
    await expect(page.locator(".chapters-loading")).toHaveCount(0);
    await expect(page.locator(".scrolly-chapter").first()).toContainText("The Cascade Range");
    // Client-rendered chapters still get Chapter's styles (they carry no scope attribute).
    const padding = await page
      .locator(".scrolly-chapter .chapter-content")
      .first()
      .evaluate((el) => getComputedStyle(el).paddingTop);
    expect(padding).toBe("32px");

    await mapReady(page, MAP);
    await layerLoaded(page, MAP, "volcanoes");
    await goToChapter(page, "range");
    await goToChapter(page, "st-helens");
    await expectCameraNear(page, MAP, [-122.1944, 46.1912], 10.5, 0.3);
    await goToChapter(page, "rainier");
    await expectCameraNear(page, MAP, [-121.7603, 46.8523], 10, 0.3);
    expect(errors).toEqual([]);
  });
});

test.describe("content collections", () => {
  test("a Markdown collection becomes a list, an overview map and one page per entry", async ({ page }) => {
    const errors = await guard(page);
    await page.goto("/volcanoes/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-volcano]")).toHaveCount(5);
    // Sorted by elevation, from the validated frontmatter.
    await expect(page.locator("[data-volcano]").first()).toContainText("Mount Fuji");
    const overview = '[data-testid="collection-map"] ml-map';
    await mapReady(page, overview);
    await expect(page.locator(`${overview} .maplibregl-marker`)).toHaveCount(5);

    await page.click('[data-volcano="pinatubo"]');
    await expect(page).toHaveURL(/\/volcanoes\/pinatubo\/?$/);
    await expect(page.locator("h1")).toHaveText("Mount Pinatubo");
    await expect(page.locator('[data-testid="entry-body"]')).toContainText("0.5 °C");
    const entry = '[data-testid="entry-map"] ml-map';
    await mapReady(page, entry);
    await expectCameraNear(page, entry, [120.35, 15.13], 10, 0.2);
    expect(errors).toEqual([]);
  });

  test("a YAML data collection of map documents renders each one", async ({ page }) => {
    const errors = await guard(page);
    await page.goto("/gallery/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-map-entry]")).toHaveCount(2);
    for (const id of ["andes", "western-pacific"]) {
      const sel = `[data-map-entry="${id}"] ml-map`;
      await mapReady(page, sel);
      await layerLoaded(page, sel, "volcanoes");
    }
    await expect(page.locator('[data-map-entry="andes"] figcaption')).toContainText("The Andean arc");
    expect(errors).toEqual([]);
  });
});
