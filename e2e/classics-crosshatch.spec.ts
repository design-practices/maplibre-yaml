/**
 * Mapzen classic: crosshatch — browser verification, which is also the demo (U10).
 *
 * @remarks
 * The static classic's two claims, proven in a real browser:
 *  1. LIVE — the hermetic twin (examples/gallery/configs/crosshatch.yaml,
 *     via viewer.html) loads both generated hatch tiles through `images:`
 *     and paints them: hasImage + queryRenderedFeatures + ink pixels.
 *  2. EJECTED — the same document, compiled by the real CLI pipeline in
 *     STRICT mode (zero lossy warnings, or the generator throws), renders in
 *     a plain `new maplibregl.Map(...)` with zero library code, resolving the
 *     tiles through the `mlym` document sprite — and paints the same map:
 *     its ink-pixel count matches the live render's within tolerance.
 *
 * "Static = its own fallback": this ejected output is the target a future
 * animated hatch effect degrades to (U12/U13).
 */
import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const OUT_DIR = join(process.cwd(), "e2e/generated/crosshatch-eject");
const BASE_URL = "http://localhost:4174/e2e/generated/crosshatch-eject";
const HATCH_LAYERS = ["crosshatch-light", "crosshatch-dark"];

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

/**
 * Total ink laid down in a screenshot of the map element: the summed
 * darkness of blue-ish pixels below the paper/basemap luminance (~220+).
 * Summed darkness rather than a count of "fully inked" pixels, because it is
 * roughly conserved under resampling: the live page samples the @2x tile
 * directly, while the ejected page (DPR 1) samples the rasterizer's @1x
 * sheet — same strokes, softer antialiasing, fewer pixels over a hard
 * color threshold (a pixel count measured 0.80 ejected/live; darkness 0.91).
 * The screenshot path is used instead of a canvas readback so neither page
 * needs preserveDrawingBuffer — the pages stay exactly what a human opens.
 */
async function inkPixels(page: Page, selector: string): Promise<number> {
  const png = PNG.sync.read(await page.locator(selector).screenshot());
  let ink = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b] = [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
    if (b <= r) continue; // wash and basemap are warm/green; ink is blue
    ink += Math.max(0, 218 - (0.299 * r + 0.587 * g + 0.114 * b));
  }
  return ink;
}

/** Let the render settle: wait for the map's idle after the probe passes. */
async function idle(page: Page, getMap: string): Promise<void> {
  await page.evaluate(
    (expr) =>
      new Promise<void>((resolve) => {
        const map = new Function(`return ${expr}`)();
        if (map.loaded() && !map.isMoving()) {
          map.once("idle", () => resolve());
          map.triggerRepaint();
        } else {
          map.once("idle", () => resolve());
        }
      }),
    getMap
  );
}

test.beforeAll(() => {
  execFileSync(
    "node",
    ["--import", "tsx", "scripts/generate-crosshatch-eject-fixture.ts", OUT_DIR, BASE_URL],
    { cwd: join(process.cwd(), "packages/cli"), stdio: "pipe" }
  );
});

test.describe("classics: crosshatch renders live and ejects to the same map", () => {
  // The ejected test compares against the live test's ink count.
  test.describe.configure({ mode: "serial" });
  let liveInk = 0;

  test("live: <ml-map> loads the generated hatch tiles and paints them", async ({ page }) => {
    const errors = await guard(page);
    await page.goto("/examples/gallery/viewer.html?example=crosshatch", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      (ids) => {
        const map = (document.getElementById("map") as any)?.getMap?.();
        return (
          map?.isStyleLoaded?.() &&
          ids.every((id: string) => map.getLayer(id)) &&
          ids.every(
            (id: string) => map.queryRenderedFeatures(undefined, { layers: [id] }).length > 0
          )
        );
      },
      HATCH_LAYERS,
      { timeout: 60_000 }
    );

    const images = await page.evaluate(() => {
      const map = (document.getElementById("map") as any).getMap();
      return ["hatch-light", "hatch-dark"].map((n) => map.hasImage(n));
    });
    expect(images, "a hatch tile did not register via images:").toEqual([true, true]);

    await idle(page, `document.getElementById("map").getMap()`);
    liveInk = await inkPixels(page, "#map");
    // Two hatched regions at zoom 4 measure ~2M here (SwiftShader, 1280x480);
    // outlines alone are a small fraction. A blank or missing tile fails here.
    expect(liveInk, "too few ink pixels — hatch tiles not painting?").toBeGreaterThan(1_000_000);

    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("ejected: strict emit output renders the same map in vanilla maplibre", async ({
    page,
  }) => {
    // The generator emitted in strict mode (it would have thrown on any
    // lossy warning); assert the recorded warnings say the same.
    const warnings = JSON.parse(readFileSync(join(OUT_DIR, "warnings.json"), "utf8"));
    expect(warnings.filter((w: { kind: string }) => w.kind === "lossy")).toEqual([]);

    const errors = await guard(page);
    await page.goto("/e2e/generated/crosshatch-eject/index.html", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      (ids) => {
        const map = (window as any).__eject?.map;
        return (
          map?.isStyleLoaded?.() &&
          ids.every(
            (id: string) => map.queryRenderedFeatures(undefined, { layers: [id] }).length > 0
          )
        );
      },
      HATCH_LAYERS,
      { timeout: 60_000 }
    );

    const images = await page.evaluate(() => {
      const map = (window as any).__eject.map;
      return ["mlym:hatch-light", "mlym:hatch-dark"].map((n) => map.hasImage(n));
    });
    expect(images, "a hatch tile did not resolve through the mlym sprite").toEqual([true, true]);

    await idle(page, "window.__eject.map");
    const ejectedInk = await inkPixels(page, "#map");
    expect(ejectedInk).toBeGreaterThan(1_000_000);
    if (liveInk > 0) {
      // Same document, same camera, same box: the two renders should put
      // (nearly) the same amount of ink down. Tolerance covers controls and
      // antialiasing differences between addImage and sprite-sheet sampling.
      const ratio = ejectedInk / liveInk;
      expect(ratio, `ink ratio ejected/live = ${ratio.toFixed(3)}`).toBeGreaterThan(0.8);
      expect(ratio, `ink ratio ejected/live = ${ratio.toFixed(3)}`).toBeLessThan(1.25);
    }

    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});
