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

test.describe("cloud-native data: PMTiles and FlatGeobuf from YAML (0.9, ml-cnv)", () => {
  test("both formats render, framed on the data, with no page JavaScript @dev", async ({ page }) => {
    const errors = await guard(page);
    const ranged: number[] = [];
    page.on("response", (r) => {
      if (/districts\.pmtiles/.test(r.url())) ranged.push(r.status());
    });
    await page.goto("/cloud-native/", { waitUntil: "domcontentloaded" });
    const map = '[data-testid="cloud-native-map"] ml-map';
    await mapReady(page, map);
    await layerLoaded(page, map, "districts");
    await expect
      .poll(() =>
        page.evaluate(
          (sel) =>
            (document.querySelector(sel) as any)
              .getMap()
              .querySourceFeatures("outlines", { sourceLayer: "districts" }).length,
          map
        )
      )
      .toBeGreaterThan(0);
    // fitTo framed the decoded FlatGeobuf data (the YAML says zoom 8).
    await expect.poll(async () => (await camera(page, map)).zoom).toBeGreaterThan(9);
    // The archive was read in parts (HTTP range requests), as on any static host.
    expect(ranged.length).toBeGreaterThan(0);
    expect(ranged.every((s) => s === 206)).toBe(true);
    await expect(page.locator(`${map} .ml-map-notice`)).toHaveCount(0);
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

  test("Reset view returns to the fitTo framing the page opened with, not the YAML camera (ml-aot.60) @dev", async ({
    page,
  }) => {
    const errors = await guard(page);
    await page.goto("/explore-fit/", { waitUntil: "domcontentloaded" });
    await mapReady(page, MAP);
    await layerLoaded(page, MAP, "volcanoes");
    // The fit is applied once the data file loads (after the map's load):
    // wait until the camera has left the YAML's [0, 0] z4 (the volcanoes
    // span the Pacific, so the fit zooms out).
    await expect
      .poll(async () => (await camera(page, MAP)).zoom, { message: "fitTo framed the data" })
      .toBeLessThan(3);
    await page.waitForTimeout(300);
    const opened = await camera(page, MAP);

    // One click at a time: a second zoom-in during the first one's animation
    // adds 1 to the in-between zoom (the production build clicks fast enough
    // to hit that).
    await page.click('[data-action="zoom-in"]');
    await expect.poll(async () => (await camera(page, MAP)).zoom).toBeCloseTo(opened.zoom + 1, 1);
    await page.click('[data-action="zoom-in"]');
    await expect.poll(async () => (await camera(page, MAP)).zoom).toBeCloseTo(opened.zoom + 2, 1);
    await page.click('[data-action="reset"]');
    await expectCameraNear(page, MAP, [opened.lng, opened.lat], opened.zoom, 0.5);
    expect(errors).toEqual([]);
  });

  test("a document with its own navigation control gets one set of zoom buttons (ml-aot.40) @dev", async ({
    page,
  }) => {
    const errors = await guard(page);
    await page.goto("/explore-controls/", { waitUntil: "domcontentloaded" });
    await mapReady(page, MAP);
    // MapLibre's +/− from the document, and FullPageMap's reset beside them.
    await expect(page.locator(`${MAP} .maplibregl-ctrl-zoom-in`)).toBeVisible();
    await expect(page.locator(`${MAP} [data-action="reset"]`)).toBeVisible();
    await expect(page.locator(`${MAP} [data-action="zoom-in"]`)).toBeHidden();
    await expect(page.locator(`${MAP} [data-action="zoom-out"]`)).toBeHidden();
    // The /explore/ document has no navigation control: all three stay.
    await page.goto("/explore/", { waitUntil: "domcontentloaded" });
    await mapReady(page, MAP);
    await expect(page.locator(`${MAP} [data-action="zoom-in"]`)).toBeVisible();
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

test.describe("languages: <FullPageMap> in the document's locale (0.9)", () => {
  const MAP = ".ml-fullpage-map ml-map";

  for (const [path, how] of [
    ["/explore-es/", "config: labelled at build time"],
    ["/explore-es-src/", "src: labelled in the browser"],
  ] as const) {
    test(`buttons, legend and map name in Spanish — ${how} @dev`, async ({ page }) => {
      const errors = await guard(page);
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await mapReady(page, MAP);
      await expect(page.getByRole("region", { name: "Volcanes del Japón" })).toHaveAccessibleDescription(
        "Los volcanes del arco japonés, marcados con círculos rojos."
      );
      await expect(page.getByRole("button", { name: "Acercar" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Alejar" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Restablecer la vista" })).toBeVisible();
      await expect(page.locator(`${MAP} summary.legend-title`)).toHaveText("Leyenda");
      await expect(page.locator(`${MAP} .legend-heading`)).toHaveText("Volcanes");
      expect(errors).toEqual([]);
    });
  }
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

    // fitBounds action frames the Andes -- top-down, although the Cascades
    // chapter before it is tilted (ml-aot.9)
    await goToChapter(page, "andes");
    await expectCameraNear(page, MAP, [-74, -19.5], undefined, 3);
    await expect.poll(() => map<number>(`Math.round(map.getPitch())`)).toBe(0);

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

test.describe("story: the shared <ml-scrollytelling> engine (ml-aot.1)", () => {
  const MAP = ".scrollytelling-container ml-map";

  test("<Scrollytelling> renders core's <ml-scrollytelling> element", async ({ page }) => {
    const errors = await guard(page);
    await page.goto("/story/", { waitUntil: "domcontentloaded" });
    await mapReady(page, MAP);
    const story = page.locator("ml-scrollytelling");
    await expect(story).toHaveCount(1);
    await expect(story).toHaveClass(/scrollytelling-container/);
    expect(await story.evaluate((el) => (el as any).story?.id)).toBe("ring-of-fire-story");
    expect(errors).toEqual([]);
  });

  test("rail dots take a real mouse click (ml-07q) and the keyboard", async ({ page }) => {
    const errors = await guard(page);
    await page.goto("/story/", { waitUntil: "domcontentloaded" });
    await mapReady(page, MAP);
    await goToChapter(page, "pacific");

    // Nothing covers the dots: each is the top element at its own centre.
    const covered = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".chapter-marker")]
        .filter((b) => {
          const r = b.getBoundingClientRect();
          return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) !== b;
        })
        .map((b) => b.dataset.chapterId)
    );
    expect(covered).toEqual([]);

    // A real mouse click (page.mouse, not dispatchEvent): the hit test is the bug.
    const dot = (await page.locator('.chapter-marker[data-chapter-id="cascades"]').boundingBox())!;
    await page.mouse.click(dot.x + dot.width / 2, dot.y + dot.height / 2);
    await expect(page.locator(".scrollytelling-container")).toHaveAttribute("data-active-chapter", "cascades");
    await expectCameraNear(page, MAP, [-122, 46.5], 6.3);

    // Keyboard: arrows move along the rail and go to the chapter.
    await page.locator('.chapter-marker[data-chapter-id="cascades"]').focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".scrollytelling-container")).toHaveAttribute("data-active-chapter", "andes");
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.chapterId)).toBe("andes");
    expect(errors).toEqual([]);
  });

  test("the wheel over the map scrolls the story; the map does not zoom", async ({ page }) => {
    const errors = await guard(page);
    await page.goto("/story/", { waitUntil: "domcontentloaded" });
    await mapReady(page, MAP);
    await goToChapter(page, "boundaries");
    await expectCameraNear(page, MAP, [-170, 15], 1.5);
    // Settled on the chapter's own zoom before the wheel turns: sample only
    // once the camera has stopped (a rounded zoom can match mid-ease, and the
    // ease finishing would then look like the wheel zooming — ml-aot.91).
    await expect
      .poll(() => page.evaluate((sel) => (document.querySelector(sel) as any).getMap().isMoving(), MAP))
      .toBe(false);
    await expect.poll(async () => Math.round((await camera(page, MAP)).zoom * 1000) / 1000).toBe(1.5);
    await expect
      .poll(() => page.evaluate((sel) => (document.querySelector(sel) as any).getMap().isMoving(), MAP))
      .toBe(false);
    const zoom = (await camera(page, MAP)).zoom;
    const before = await page.evaluate(() => scrollY);
    // Right-hand side of the map, clear of the left-aligned card.
    await page.mouse.move(1000, 600);
    expect(await page.evaluate(() => document.elementFromPoint(1000, 600)?.tagName)).toBe("CANVAS");
    await page.mouse.wheel(0, 120);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 100);
    expect((await camera(page, MAP)).zoom).toBeCloseTo(zoom, 5);
    expect(errors).toEqual([]);
  });

  test("mobile: the chapter's subject shows above its card; the rail stays off it (ml-aot.8)", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = await guard(page);
    await page.goto("/story/", { waitUntil: "domcontentloaded" });
    await mapReady(page, MAP);
    await layerLoaded(page, MAP, "volcanoes");
    // Bring the Japan card to the middle of the screen, as a reader would.
    await page.evaluate(() => {
      const card = document.querySelector('.scrolly-chapter[data-chapter-id="japan"] .chapter-content')!;
      const r = card.getBoundingClientRect();
      scrollBy(0, r.top + r.height / 2 - innerHeight / 2);
    });
    await expect(page.locator(".scrollytelling-container")).toHaveAttribute("data-active-chapter", "japan");
    await expectCameraNear(page, MAP, [135, 34], 4.6);
    const layout = await page.evaluate((sel) => {
      const el = document.querySelector(sel) as any;
      const map = el.getMap();
      const box = el.getBoundingClientRect();
      const fuji = map.project([138.7274, 35.3606]);
      const card = document
        .querySelector('.scrolly-chapter[data-chapter-id="japan"] .chapter-content')!
        .getBoundingClientRect();
      const rail = [...document.querySelectorAll(".chapter-marker")].map((b) => b.getBoundingClientRect());
      return {
        fujiY: box.top + fuji.y,
        cardTop: card.top,
        cardRight: card.right,
        railLeft: Math.min(...rail.map((r) => r.left)),
        scrollWidth: document.documentElement.scrollWidth,
      };
    }, MAP);
    expect(layout.fujiY).toBeGreaterThan(0);
    expect(layout.fujiY, "Mount Fuji shows above the Japan card").toBeLessThan(layout.cardTop);
    expect(layout.railLeft, "the rail sits beside the card, not on it").toBeGreaterThanOrEqual(layout.cardRight);
    expect(layout.scrollWidth).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("a broken src story shows one error card with the line and the did-you-mean (ml-aot.7) @dev", async ({
    page,
  }) => {
    const errors = await guard(page);
    await page.goto("/story-broken/", { waitUntil: "domcontentloaded" });
    const card = page.locator(".scrolly-error");
    await expect(card).toBeVisible();
    // The message names the chapter, so the 0-based path is not repeated (ml-aot.62).
    await expect(card).toContainText(/Chapter 2 \("rainier"\)/);
    await expect(card).not.toContainText("chapters.1.");
    await expect(card).toContainText(/line \d+/);
    await expect(card).toContainText(/centre[\s\S]*center/);
    await page.waitForTimeout(1000); // a ghost card would be up by now
    await expect(page.locator(".scrolly-error, .ml-map-error")).toHaveCount(1);
    await expect(page.getByText("No configuration provided")).toHaveCount(0);
    // The one console error is the story's own report.
    expect(errors.filter((e) => !/ml-scrollytelling/.test(e))).toEqual([]);
  });

  test("a slow src story never reports 'No configuration provided' (ml-4al) @dev", async ({ page }) => {
    const errors = await guard(page);
    await page.route("**/stories/cascadia.yaml", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      return route.continue();
    });
    await page.addInitScript(() => {
      (window as any).__mapErrors = [];
      document.addEventListener("ml-map:error", (e: any) =>
        (window as any).__mapErrors.push(JSON.stringify(e.detail?.errors ?? e.detail?.error?.message))
      );
    });
    await page.goto("/story-runtime/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".chapters-loading")).toBeVisible();
    await mapReady(page, MAP);
    await expect(page.locator(".scrolly-chapter")).toHaveCount(3);
    expect(await page.evaluate(() => (window as any).__mapErrors)).toEqual([]);
    await expect(page.getByText("No configuration provided")).toHaveCount(0);
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

  test("getCollectionItemWithLocationSchema entries become typed pages with a point map", async ({ page }) => {
    const errors = await guard(page);
    await page.goto("/field-notes/krakatau-1883/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toHaveText("Krakatau, August 1883");
    await expect(page.locator('[data-testid="note-meta"]')).toContainText("Krakatau · 2024-08-27");
    const map = '[data-testid="note-map"] ml-map';
    await mapReady(page, map);
    await expectCameraNear(page, map, [105.42, -6.1], 8, 0.2);
    expect(errors).toEqual([]);
  });
});

test.describe("view transitions: <ClientRouter /> soft navigation (ml-aot.22)", () => {
  const FULL = ".ml-fullpage-map ml-map";
  const INLINE = '[data-testid="vt-inline-map"] ml-map';

  /** MapLibre's stylesheet is applied: its control corners are positioned. */
  const maplibreCss = (page: Page) =>
    page.evaluate(() => {
      const corner = document.querySelector(".maplibregl-ctrl-bottom-right");
      return corner ? getComputedStyle(corner).position : "no corner";
    });

  async function zoomInWorks(page: Page): Promise<void> {
    await mapReady(page, FULL);
    const before = (await camera(page, FULL)).zoom;
    await page.click('[data-action="zoom-in"]');
    await expect
      .poll(async () => (await camera(page, FULL)).zoom, { message: "zoom-in moved the camera" })
      .toBeCloseTo(before + 1, 1);
  }

  test("maps, FullPageMap buttons and MapLibre CSS survive soft navigations @dev", async ({ page }) => {
    const errors = await guard(page);
    // <ml-map>'s CSS probe (ml-aot.10) warns, not errors; here it is a failure.
    page.on("console", (m) => {
      if (/CSS does not appear to be loaded/.test(m.text())) errors.push(`css probe: ${m.text()}`);
    });
    await page.goto("/transitions/", { waitUntil: "domcontentloaded" });
    // Marks the document: it survives soft navigations, not full loads.
    await page.evaluate(() => ((window as any).__softNav = true));
    await zoomInWorks(page);
    expect(await maplibreCss(page)).toBe("absolute");

    for (let visit = 0; visit < 2; visit++) {
      await page.click('[data-testid="vt-to-inline"]');
      await expect(page).toHaveURL(/\/transitions\/inline\/?$/);
      await mapReady(page, INLINE);
      expect(await maplibreCss(page), "MapLibre CSS after a soft navigation").toBe("absolute");

      await page.click('[data-testid="vt-to-full"]');
      await expect(page).toHaveURL(/\/transitions\/?$/);
      // Before ml-aot.22 the buttons were bound to the first visit's elements.
      await zoomInWorks(page);
      expect(await maplibreCss(page)).toBe("absolute");
    }

    expect(await page.evaluate(() => (window as any).__softNav), "navigations were soft").toBe(true);
    expect(errors).toEqual([]);
  });

  test("a story survives soft navigations: its CSS, a fresh map per visit, the rail on a revisit @dev", async ({
    page,
  }) => {
    const errors = await guard(page);
    page.on("console", (m) => {
      if (/CSS does not appear to be loaded/.test(m.text())) errors.push(`css probe: ${m.text()}`);
    });
    const STORY = "ml-scrollytelling ml-map";
    // Start ON the story (a full load: whatever its scripts inject is in the
    // head), then leave and come back twice with soft navigations.
    await page.goto("/transitions/story/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      (window as any).__softNav = true;
      (window as any).__storyMaps = [];
    });

    for (let visit = 0; visit < 3; visit++) {
      if (visit > 0) {
        await page.click('[data-testid="vt-to-story"]');
        await expect(page).toHaveURL(/\/transitions\/story\/?$/);
      }
      await mapReady(page, STORY);
      await page.evaluate(() =>
        (window as any).__storyMaps.push((document.querySelector("ml-scrollytelling") as any).getMap())
      );
      // The story's own CSS and MapLibre's both applied after the head swap.
      const styles = await page.evaluate(() => ({
        sticky: getComputedStyle(document.querySelector(".scrolly-map-container")!).position,
        corner: getComputedStyle(document.querySelector(".maplibregl-ctrl-bottom-right")!).position,
      }));
      expect(styles, `visit ${visit + 1}`).toEqual({ sticky: "sticky", corner: "absolute" });
      // One story, one map on the page.
      expect(await page.locator("ml-scrollytelling").count()).toBe(1);
      expect(await page.locator(".maplibregl-map").count()).toBe(1);

      // The rail works on every visit (a real mouse click) -- once the view
      // transition's snapshot overlay, which takes every click while it
      // animates, has gone and the dot is the element under the pointer.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const b = document.querySelector('.chapter-marker[data-chapter-id="cascades"]')!;
            const r = b.getBoundingClientRect();
            return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b;
          })
        )
        .toBe(true);
      const dot = (await page.locator('.chapter-marker[data-chapter-id="cascades"]').boundingBox())!;
      await page.mouse.click(dot.x + dot.width / 2, dot.y + dot.height / 2);
      await expect(page.locator("ml-scrollytelling")).toHaveAttribute("data-active-chapter", "cascades");
      await expectCameraNear(page, STORY, [-122, 46.5], 6.3);

      // Leave through the link in the map's corner slot.
      await page.locator('[data-testid="vt-story-to-inline"]').click();
      await expect(page).toHaveURL(/\/transitions\/inline\/?$/);
      await mapReady(page, '[data-testid="vt-inline-map"] ml-map');
      // The story's map went with its page: removed, not leaked.
      expect(
        await page.evaluate((i) => (window as any).__storyMaps[i]._removed === true, visit),
        `visit ${visit + 1}: the story's map was removed`
      ).toBe(true);
    }

    expect(await page.evaluate(() => (window as any).__storyMaps[0] !== (window as any).__storyMaps[1])).toBe(true);
    expect(await page.evaluate(() => (window as any).__softNav), "navigations were soft").toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe("author hints: dev builds and the debug prop (ml-aot.57)", () => {
  test("<Map debug> renders the attribute; astro dev marks the page a dev build, a built site does not @dev", async ({
    page,
  }) => {
    const errors = await guard(page);
    await page.goto("/author-hints/", { waitUntil: "domcontentloaded" });
    const plain = '[data-testid="plain-map"] ml-map';
    const debug = '[data-testid="debug-map"] ml-map';
    await mapReady(page, plain);
    await mapReady(page, debug);
    expect(await page.locator(debug).getAttribute("debug")).toBe("");
    expect(await page.locator(plain).getAttribute("debug")).toBeNull();
    const devFlag = await page.evaluate(() => (globalThis as any).__MAPLIBRE_YAML_DEV__ === true);
    expect(devFlag).toBe(process.env.ASTRO_SITE_MODE === "dev");
    // Served from localhost (preview) or by astro dev: both maps show the hint.
    for (const map of [plain, debug]) {
      await expect(page.locator(`${map} .ml-map-notice`)).toContainText('"legend" belongs at the top level');
    }
    expect(errors).toEqual([]);
  });
});
