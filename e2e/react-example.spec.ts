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
 */
import { test, expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
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
      await expect(page.locator("#yaml")).toContainText("clicked: Cairo");
      await expect(page.getByTestId("event-log")).toContainText("layer-click · cities · Cairo");

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

      // The YamlMap snippet reads the zoom through ref + mapReady().
      await expect(page.locator("#yaml")).toContainText("Zoom 0.9");
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

    test("an equal config never rebuilds the map; a changed one does", async ({ page }) => {
      const errors = await open(page);
      const mapEl = page.locator("#config ml-map");
      await mapEl.evaluate((el: any) => ((window as any).__firstConfigMap = el.getMap()));

      const rerender = page.locator("#config").getByRole("button", { name: /Re-render/ });
      for (let i = 0; i < 3; i++) await rerender.click();
      await expect(page.getByTestId("config-renders")).toHaveText("4");
      await page.waitForTimeout(300);
      expect(await loadsIn(page, "config")).toBe(1);
      expect(await mapEl.evaluate((el: any) => el.getMap() === (window as any).__firstConfigMap)).toBe(true);

      await page.locator("#config").getByRole("button", { name: "Change color" }).click();
      await expect.poll(() => loadsIn(page, "config")).toBe(2);
      expect(await mapEl.evaluate((el: any) => el.getMap() === (window as any).__firstConfigMap)).toBe(false);
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

        await panel.getByRole("button", { name: "Change color" }).click();
        await expect(page.getByTestId("r19-loads")).toHaveText("2");

        // onml-map:layer-click, typed detail -> React state.
        const mapEl = panel.locator("ml-map");
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
