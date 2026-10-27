/**
 * examples/react, driven in a browser on React 18 AND React 19 (U21, D-A11).
 *
 * @remarks
 * The app is built four times from one source (`pnpm --filter
 * @maplibre-yaml/example-react build`): React 19 and React 18 (npm aliases +
 * a Vite alias, see the example's vite.config.ts), each as a production
 * build and as a development build, where StrictMode really double-runs
 * effects. All four are served hermetically by e2e/server.mjs, basemap and
 * data included, and every test runs against each of them unless
 * `REACT_MAJORS` narrows the majors (the CI react-example matrix runs one
 * major per leg).
 *
 * Asserted, per major: every map renders and fires `ml-map:load` with no
 * `ml-map:error` and no console error; events reach React (layer click,
 * params panel); `mapReady()` resolves, including one requested before the
 * config existed (ml-mpm); React-rendered slot children drive the map;
 * re-rendering with an equal config does not rebuild the map (ml-i10) while
 * a changed one does; unmount leaves no canvas behind and remount makes
 * exactly one. The React 19 build also proves the object `config` and the
 * `onml-map:*` props; the React 18 build proves those are absent, not broken.
 *
 * recipes.html runs the docs' "Common tasks" recipes, unchanged, on the quick
 * start's map document (served at /map.yaml, as in a reader's app): a click
 * shows the quake's `place`, the fly-to button moves the map, the
 * `useMapEvent` hook fires once per click under StrictMode, and the
 * "putting it together" example shows the zoom, the click and an error.
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const MAJORS = (process.env.REACT_MAJORS ?? "18,19").split(",").map((s) => s.trim());
const BUILDS = [
  { major: "19", dir: "dist", dev: false },
  { major: "19", dir: "dist-dev", dev: true },
  { major: "18", dir: "dist-react18", dev: false },
  { major: "18", dir: "dist-react18-dev", dev: true },
].filter((b) => MAJORS.includes(b.major));

/** Fail on any page error, console error, or off-origin request. */
async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || /^(data|blob):/.test(url)) {
      return route.continue();
    }
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return errors;
}

type Recorded = { type: string; section: string; message?: string };
const recorded = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mlMapEvents: Recorded[] }).__mlMapEvents);
const loadsIn = async (page: Page, section: string) =>
  (await recorded(page)).filter((e) => e.type === "ml-map:load" && e.section === section).length;

/** Sections whose map must load, per build. */
const SECTIONS: Record<string, string[]> = {
  "18": ["yaml", "config", "slots", "mount"],
  "19": ["yaml", "config", "slots", "mount", "react19"],
};

for (const { major, dir: build, dev } of BUILDS) {
  test.describe(`examples/react on React ${major} (${dev ? "development" : "production"} build)`, () => {
    test.beforeAll(() => {
      expect(
        existsSync(join(ROOT, "examples/react", build, "index.html")),
        `examples/react/${build}/ is missing: run \`pnpm --filter @maplibre-yaml/example-react build\` (pnpm build does it)`
      ).toBe(true);
    });

    async function open(page: Page) {
      const errors = await guard(page);
      await page.goto(`/examples/react/${build}/index.html`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("react-version")).toHaveText(new RegExp(`^React ${major}\\.`));
      await expect(page.getByTestId("build-mode")).toContainText(dev ? "development" : "production");
      for (const section of SECTIONS[major]) {
        await expect.poll(() => loadsIn(page, section), { timeout: 60_000 }).toBe(1);
      }
      return errors;
    }

    test("every map renders, with no ml-map:error and no console error", async ({ page }) => {
      const errors = await open(page);

      expect((await recorded(page)).filter((e) => e.type === "ml-map:error")).toEqual([]);
      expect(await page.locator("canvas.maplibregl-canvas").count()).toBe(SECTIONS[major].length);
      // Nothing but the maps' own chrome: no "Configuration Error" card anywhere.
      expect(await page.locator(".ml-map-error").count()).toBe(0);
      expect(errors).toEqual([]);
    });

    test("events reach React: layer click and the params panel", async ({ page }) => {
      const errors = await open(page);
      const yamlMap = page.locator("#yaml ml-map");

      // Click Cairo: project its coordinates through the live map.
      const point = await yamlMap.evaluate((el: any) => {
        const p = el.getMap().project([31.248, 30.052]);
        return { x: p.x, y: p.y };
      });
      await yamlMap.locator("canvas").click({ position: point });
      await expect(page.getByTestId("event-log")).toContainText("layer-click · cities · Cairo");
      // Popups open above the corner chrome (ml-3d0, #128), so close Cairo's
      // before reaching for the params panel it overlaps — as a user would.
      await page.locator("#yaml .maplibregl-popup-close-button").click();
      await expect(page.locator("#yaml .maplibregl-popup")).toHaveCount(0);

      // The document's params panel writes state; the event bubbles to React.
      const slider = page.locator("#yaml .ml-map-params input[type=range]");
      await slider.fill("10");
      await expect(page.getByTestId("event-log")).toContainText("parameter-change · minPop = 10");
      const megaToggle = page.locator("#yaml .ml-map-params input[type=checkbox]").nth(1);
      await megaToggle.uncheck();
      await expect(page.getByTestId("event-log")).toContainText("layer-visibility · megacities off");
      expect(errors).toEqual([]);
    });

    test("mapReady() resolves, even when asked before the config existed", async ({ page }) => {
      const errors = await open(page);

      // LateConfigMap called mapReady() BEFORE assigning el.config (ml-mpm).
      await expect(page.getByTestId("late-center")).toHaveText("-20.0, 25.0");
      const zoom = await page
        .locator("#config ml-map")
        .evaluate(async (el: any) => (await el.mapReady()).getZoom());
      expect(zoom).toBeCloseTo(1.2, 5);
      expect(errors).toEqual([]);
    });

    test("React-rendered slot children sit in the corner and drive the map", async ({ page }) => {
      const errors = await open(page);
      const corner = page.locator("#slots .ml-map-chrome-top-left");
      await expect(corner.locator(".map-buttons")).toBeVisible();

      const zoom = () => page.locator("#slots ml-map").evaluate((el: any) => el.getMap().getZoom());
      const before = await zoom();
      await corner.getByRole("button", { name: "Zoom in" }).click();
      await expect.poll(zoom).toBeCloseTo(before + 1, 5);
      expect(errors).toEqual([]);
    });

    test("an equal config never rebuilds the map; a changed one updates in place", async ({ page }) => {
      const errors = await open(page);
      const mapEl = page.locator("#config ml-map");
      await mapEl.evaluate((el: any) => ((window as any).__firstConfigMap = el.getMap()));
      const routeColour = () => mapEl.evaluate((el: any) => el.getMap().getPaintProperty("routes", "line-color"));
      const before = await routeColour();

      const rerender = page.locator("#config").getByRole("button", { name: /Re-render/ });
      for (let i = 0; i < 3; i++) await rerender.click();
      await expect(page.getByTestId("config-renders")).toHaveText("4");
      await page.waitForTimeout(300);
      expect(await loadsIn(page, "config")).toBe(1);
      expect(await mapEl.evaluate((el: any) => el.getMap() === (window as any).__firstConfigMap)).toBe(true);

      // A changed document applies in place (live documents, 0.10): the
      // element reports what changed, the map object and its one load stay.
      const applied = mapEl.evaluate(
        (el: any) =>
          new Promise<{ summary: { propertiesSet: unknown[]; rebuild: boolean; failures: unknown[] } }>((resolve) =>
            el.addEventListener("ml-map:update-applied", (e: CustomEvent) => resolve(e.detail), { once: true })
          )
      );
      await page.locator("#config").getByRole("button", { name: "Change color" }).click();
      const { summary } = await applied;
      expect(summary.rebuild).toBe(false);
      expect(summary.failures).toEqual([]);
      // routesDocument(color) colours the routes and the airports alike.
      expect(summary.propertiesSet).toEqual(
        expect.arrayContaining([
          { layerId: "routes", property: "line-color" },
          { layerId: "airports", property: "circle-color" },
        ])
      );
      expect(summary.propertiesSet).toHaveLength(2);
      expect(await routeColour()).not.toBe(before);
      await page.waitForTimeout(300);
      expect(await loadsIn(page, "config")).toBe(1);
      expect(await mapEl.evaluate((el: any) => el.getMap() === (window as any).__firstConfigMap)).toBe(true);
      expect(errors).toEqual([]);
    });

    if (major === "19") {
      test("React 19: object config + typed onml-map:* props, no rebuild for an equal object", async ({ page }) => {
        const errors = await open(page);
        // onml-map:load is a React prop here, not a ref listener.
        await expect(page.getByTestId("r19-loads")).toHaveText("1");

        const panel = page.locator("#react19");
        const rerender = panel.getByRole("button", { name: /Re-render/ });
        for (let i = 0; i < 3; i++) await rerender.click();
        await expect(page.getByTestId("r19-renders")).toHaveText("4");
        await page.waitForTimeout(300);
        await expect(page.getByTestId("r19-loads")).toHaveText("1");

        // A changed object updates the map in place (live documents, 0.10):
        // the typed onml-map:update-applied prop fires, the one load stays.
        const mapEl = panel.locator("ml-map");
        const applied = mapEl.evaluate(
          (el: any) =>
            new Promise<{ summary: { propertiesSet: unknown[] } }>((resolve) =>
              el.addEventListener("ml-map:update-applied", (e: CustomEvent) => resolve(e.detail), { once: true })
            )
        );
        await panel.getByRole("button", { name: "Change color" }).click();
        expect((await applied).summary.propertiesSet).toEqual(
          expect.arrayContaining([
            { layerId: "routes", property: "line-color" },
            { layerId: "airports", property: "circle-color" },
          ])
        );
        await page.waitForTimeout(300);
        await expect(page.getByTestId("r19-loads")).toHaveText("1");

        // onml-map:layer-click, typed detail -> React state.
        const point = await mapEl.evaluate((el: any) => {
          const p = el.getMap().project([36.82, -1.29]); // Nairobi
          return { x: p.x, y: p.y };
        });
        await mapEl.locator("canvas").click({ position: point });
        await expect(page.getByTestId("r19-readout")).toContainText("layer clicked: airports");
        expect(errors).toEqual([]);
      });
    } else {
      test("React 18: the React-19-only panel is stubbed, not half-working", async ({ page }) => {
        const errors = await open(page);
        await expect(page.getByTestId("r19-stub")).toBeVisible();
        expect(await page.locator("#react19 ml-map").count()).toBe(0);
        expect(errors).toEqual([]);
      });
    }

    test("unmount leaves no canvas behind; remount makes exactly one", async ({ page }) => {
      const errors = await open(page);
      // StrictMode is live in the development build: the effect that assigns
      // the late config ran twice (mount, simulated unmount, mount), and the
      // element still loaded exactly once (the second, equal config is a no-op).
      const effectRuns = () =>
        page.evaluate(() => (window as unknown as { __lateConfigEffectRuns: number }).__lateConfigEffectRuns);
      expect(await effectRuns()).toBe(dev ? 2 : 1);
      const total = SECTIONS[major].length;
      const canvases = () => page.locator("canvas.maplibregl-canvas").count();
      const toggle = page.getByTestId("mount-toggle");

      for (let cycle = 0; cycle < 2; cycle++) {
        await toggle.click(); // unmount
        await expect.poll(canvases).toBe(total - 1);
        await expect(page.getByTestId("canvas-count")).toHaveText(String(total - 1));

        await toggle.click(); // mount: a fresh element, config from an effect
        await expect.poll(() => loadsIn(page, "mount")).toBe(cycle + 2);
        await expect.poll(canvases).toBe(total);
      }

      // The late-config element never flashed "No configuration provided".
      expect((await recorded(page)).filter((e) => e.type === "ml-map:error")).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}

/** recipes.html sections whose map must load, per major. */
const RECIPE_SECTIONS: Record<string, string[]> = {
  "18": ["click", "flyto", "hook", "together"],
  "19": ["click19", "click", "flyto", "hook", "together"],
};

/**
 * A quake inside the map's view, picked from what MapLibre rendered: where to
 * click (`nth` visible quake) and the `place` of the top one at that point,
 * which is the feature a click reports.
 */
async function quakeIn(mapEl: Locator, nth: number) {
  return mapEl.evaluate((el: any, nth: number) => {
    const map = el.getMap();
    const canvas = map.getCanvas();
    const [w, h] = [canvas.clientWidth, canvas.clientHeight];
    const inView = map
      .queryRenderedFeatures({ layers: ["earthquakes"] })
      .map((f: any) => map.project(f.geometry.coordinates))
      .filter((p: any) => p.x > 60 && p.x < w - 60 && p.y > 60 && p.y < h - 60);
    const p = inView.at(nth);
    const top = map.queryRenderedFeatures([p.x, p.y], { layers: ["earthquakes"] })[0];
    return { position: { x: p.x, y: p.y }, place: top.properties.place as string };
  }, nth);
}

for (const { major, dir: build, dev } of BUILDS) {
  test.describe(`examples/react recipes.html on React ${major} (${dev ? "development" : "production"} build)`, () => {
    /** The quick start's document, served where the recipes ask for it. */
    async function serveMapYaml(page: Page, body = readFileSync(join(ROOT, "examples/react", build, "map.yaml"), "utf8")) {
      await page.route(
        (url) => url.pathname === "/map.yaml",
        (route) => route.fulfill({ contentType: "text/yaml; charset=utf-8", body })
      );
    }

    async function open(page: Page) {
      const errors = await guard(page);
      await serveMapYaml(page);
      await page.goto(`/examples/react/${build}/recipes.html`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("react-version")).toHaveText(new RegExp(`^React ${major}\\.`));
      for (const section of RECIPE_SECTIONS[major]) {
        await expect.poll(() => loadsIn(page, section), { timeout: 60_000 }).toBe(1);
      }
      return errors;
    }

    /** Click a quake on the map in `section`; returns its place. */
    async function clickQuake(page: Page, section: string, nth = 0) {
      const mapEl = page.locator(`#${section} ml-map`);
      const { position, place } = await quakeIn(mapEl, nth);
      await mapEl.locator("canvas").click({ position });
      return place;
    }

    test("a click shows the quake's place (ref + addEventListener)", async ({ page }) => {
      const errors = await open(page);
      await expect(page.locator("#click")).toContainText("Clicked: nothing yet");
      const place = await clickQuake(page, "click");
      expect(place).toBeTruthy();
      await expect(page.locator("#click")).toContainText(`Clicked: ${place}`);
      expect((await recorded(page)).filter((e) => e.type === "ml-map:error")).toEqual([]);
      expect(errors).toEqual([]);
    });

    if (major === "19") {
      test("React 19: an onml-map:layer-click prop shows the quake's place", async ({ page }) => {
        const errors = await open(page);
        const place = await clickQuake(page, "click19");
        await expect(page.locator("#click19")).toContainText(`Clicked: ${place}`);
        expect(errors).toEqual([]);
      });
    } else {
      test("React 18: the onml-map:* recipe is stubbed, not half-working", async ({ page }) => {
        const errors = await open(page);
        await expect(page.getByTestId("r19-click-stub")).toBeVisible();
        expect(await page.locator("#click19 ml-map").count()).toBe(0);
        expect(errors).toEqual([]);
      });
    }

    test("the fly-to button moves the map to Japan", async ({ page }) => {
      const errors = await open(page);
      const mapEl = page.locator("#flyto ml-map");
      await page.locator("#flyto").getByRole("button", { name: "Fly to Japan" }).click();
      const camera = () =>
        mapEl.evaluate((el: any) => {
          const map = el.getMap();
          return { lng: map.getCenter().lng, lat: map.getCenter().lat, zoom: map.getZoom() };
        });
      await expect.poll(async () => (await camera()).zoom, { timeout: 15_000 }).toBeCloseTo(4.5, 5);
      const { lng, lat } = await camera();
      expect(lng).toBeCloseTo(138, 3);
      expect(lat).toBeCloseTo(37, 3);
      expect(errors).toEqual([]);
    });

    test("useMapEvent fires once per click, StrictMode included", async ({ page }) => {
      const errors = await open(page);
      const items = page.locator("#hook ol li");
      const first = await clickQuake(page, "hook", 0);
      await expect(items).toHaveText([first]);
      await page.locator("#hook .maplibregl-popup-close-button").click();
      const second = await clickQuake(page, "hook", -1);
      await expect(items).toHaveText([first, second]);
      await page.waitForTimeout(300);
      await expect(items).toHaveCount(2);
      expect(errors).toEqual([]);
    });

    test("putting it together: zoom and click reach React", async ({ page }) => {
      const errors = await open(page);
      const card = page.locator("#together");
      await expect(card).toContainText("Zoom 1.0 · clicked: nothing yet");
      const place = await clickQuake(page, "together");
      await expect(card).toContainText(`clicked: ${place}`);
      await card.locator("ml-map").evaluate((el: any) => el.getMap().jumpTo({ zoom: 3 }));
      await expect(card).toContainText("Zoom 3.0");
      await expect(card.getByText("Map problem")).toHaveCount(0);
      expect(errors).toEqual([]);
    });

    test("putting it together: a broken document's errors reach React", async ({ page }) => {
      await guard(page);
      await serveMapYaml(page, "type: map\nlayers: [\n");
      await page.goto(`/examples/react/${build}/recipes.html`, { waitUntil: "domcontentloaded" });
      // A YAML syntax error arrives as `errors`, joined into one line.
      await expect(page.locator("#together").getByText("Map problem: YAML syntax error")).toBeVisible();
      await expect(page.locator("#together .ml-map-error")).toBeVisible();
    });
  });
}
