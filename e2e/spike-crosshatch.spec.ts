/**
 * U12 SPIKE session 2 — Tangram's crosshatch buildings on deck.gl.
 *
 * @remarks
 * EVIDENCE, NOT PRODUCT (plan U12, ml-rzm). Session 1 proved a flat hatch
 * fill; the maintainer's review retargeted the gate at the effect that makes
 * the Mapzen crosshatch: tonal hatching on extruded buildings (stroke density
 * follows light per face). Drives packages/spike-deck-hatch/page/crosshatch.html
 * over the vendored lower-Manhattan tile fixture (hermetic), through:
 *
 *  1. the effect renders interleaved in the static layer's slot (below labels)
 *     and visibly differs from the static fallback;
 *  2. absence of the runtime → the same document's static preset, live AND
 *     ejected (strict refuses on the lossy effect, x-effect stripped, the
 *     ejected style renders the hatched fill-extrusion in plain maplibre-gl);
 *  3. KTD7 static clause (no triggerRepaint while idle) + clean teardown;
 *  4. KTD7 perf on this real workload: effect vs the static preset, same run,
 *     5 s rotating-camera samples.
 *
 * SPIKE_GPU=1 runs on the host GPU (ANGLE); default is SwiftShader. Numbers
 * land in e2e/generated/spike-crosshatch-perf.json.
 */
import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const ROOT = process.cwd();
const PAGE = "/packages/spike-deck-hatch/page/crosshatch.html";
const OUT = join(ROOT, "e2e/generated/spike-crosshatch");
const PORT = Number(process.env.VERIFY_PORT ?? 4174);
const ORIGIN = `http://localhost:${PORT}`;

if (process.env.SPIKE_GPU) {
  test.use({
    launchOptions: {
      args: ["--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist", "--enable-gpu"],
    },
  });
}
test.use({ viewport: { width: 1200, height: 800 } });
test.describe.configure({ mode: "serial" });

async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || /^(data|blob):/.test(url)) {
      return route.continue();
    }
    errors.push(`external request: ${url}`);
    return route.abort();
  });
  return errors;
}

/** Open the page and wait until maplibre is idle and deck's tiles are in. */
async function open(page: Page, fx: "crosshatch" | "none", extra = ""): Promise<void> {
  await page.goto(`${PAGE}?tiles=fixture&fx=${fx}${extra}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (window as any).__spike?.ready, undefined, { timeout: 60_000 });
  await page.evaluate(async () => {
    const s = (window as any).__spike;
    if (s.handle) await s.handle.loaded();
    await s.spike.idle(s.map);
    await new Promise((r) => setTimeout(r, 500));
  });
}

/** Share of canvas pixels within ink distance (dark strokes). */
async function inkShare(page: Page): Promise<{ png: Buffer; ink: number }> {
  const png = await page.locator("canvas.maplibregl-canvas").screenshot();
  const img = PNG.sync.read(png);
  let ink = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i]! < 130 && img.data[i + 1]! < 130 && img.data[i + 2]! < 130) ink++;
  }
  return { png, ink: ink / (img.width * img.height) };
}

test("1. crosshatch renders interleaved in the buildings slot, below labels", async ({ page }) => {
  const errors = await guard(page);
  await open(page, "crosshatch");
  const state = await page.evaluate(() => {
    const s = (window as any).__spike;
    return {
      placementOk: s.handle.placementOk,
      slots: s.handle.slots,
      order: s.map.getLayersOrder(),
      staticHidden: s.map.getLayoutProperty("buildings", "visibility") === "none",
    };
  });
  expect(state.placementOk).toBe(true);
  expect(state.slots).toEqual([{ layerId: "buildings", beforeId: "place-labels" }]);
  const gi = state.order.indexOf("deck-maplibre-layer-group-before:place-labels");
  expect(gi).toBeGreaterThan(state.order.indexOf("buildings"));
  expect(state.order[gi + 1]).toBe("place-labels");
  expect(state.staticHidden).toBe(true);

  const fx = await inkShare(page);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "effect.png"), fx.png);

  await open(page, "none");
  const base = await inkShare(page);
  writeFileSync(join(OUT, "static.png"), base.png);
  console.log(`[spike] ink share: effect ${fx.ink.toFixed(3)} vs static ${base.ink.toFixed(3)}`);
  // The effect is not the static preset: lit faces go to paper, shaded
  // faces to dense strokes — a different image with a different ink budget.
  expect(fx.png.equals(base.png)).toBe(false);
  expect(Math.abs(fx.ink - base.ink)).toBeGreaterThan(0.01);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("2. no runtime → the static preset, live and ejected", async ({ page }) => {
  const errors = await guard(page);
  await open(page, "none");
  const live = await page.evaluate(
    () => (window as any).__spike.map.queryRenderedFeatures(undefined, { layers: ["buildings"] }).length
  );
  expect(live).toBeGreaterThan(500);

  const out = execFileSync(
    "node",
    ["--import", "tsx", "../spike-deck-hatch/scripts/emit-crosshatch.ts", OUT, ORIGIN],
    { cwd: join(ROOT, "packages/cli"), encoding: "utf8" }
  );
  const result = JSON.parse(readFileSync(join(OUT, "result.json"), "utf8"));
  console.log("[spike] emit:", out.split("\n").length, "lines;", JSON.stringify(result.lossy));
  expect(result.strictRefused).toBe(true);
  expect(result.lossy).toEqual(["layers.buildings.x-effect"]);
  expect(result.xEffectStripped).toBe(true);
  expect(result.buildingsLayer).toEqual([{ type: "fill-extrusion", pattern: "mlym:building-hatch" }]);

  await page.goto("/e2e/generated/spike-crosshatch/index.html");
  await page.waitForFunction(() => (window as any).__eject?.map?.loaded(), undefined, { timeout: 60_000 });
  await page.evaluate(
    () => new Promise((r) => { const m = (window as any).__eject.map; m.once("idle", r); m.triggerRepaint(); })
  );
  const ejected = await page.evaluate(
    () => (window as any).__eject.map.queryRenderedFeatures(undefined, { layers: ["buildings"] }).length
  );
  console.log(`[spike] buildings rendered: live static ${live}, ejected ${ejected}`);
  expect(ejected).toBeGreaterThan(500);
  writeFileSync(join(OUT, "ejected.png"), await page.locator("canvas").screenshot());
  expect(errors, errors.join("\n")).toEqual([]);
});

test("3. static clause + teardown", async ({ page }) => {
  const errors = await guard(page);
  await open(page, "crosshatch");
  const idle = await page.evaluate(async () => {
    const s = (window as any).__spike;
    s.counters.reset();
    await new Promise((r) => setTimeout(r, 2000));
    return { triggerRepaint: s.counters.triggerRepaint, raf: s.counters.raf };
  });
  console.log(`[spike] idle 2s with effect: ${JSON.stringify(idle)}`);
  expect(idle.triggerRepaint).toBe(0);

  const after = await page.evaluate(async () => {
    const s = (window as any).__spike;
    s.detach();
    await new Promise((r) => setTimeout(r, 300));
    s.counters.reset();
    await new Promise((r) => setTimeout(r, 2000));
    return {
      raf: s.counters.raf,
      staticVisible: s.map.getLayoutProperty("buildings", "visibility") !== "none",
      deckGroups: s.map.getLayersOrder().filter((id: string) => id.startsWith("deck-")),
    };
  });
  console.log(`[spike] after teardown: ${JSON.stringify(after)}`);
  expect(after.staticVisible).toBe(true);
  expect(after.deckGroups).toEqual([]);
  expect(after.raf).toBeLessThanOrEqual(2);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("4. KTD7 perf: crosshatch vs the static preset, same run", async ({ page }) => {
  test.setTimeout(240_000);
  await guard(page);
  const sample = async (fx: "crosshatch" | "none", extra = "") => {
    await open(page, fx, extra);
    return page.evaluate(() => {
      const s = (window as any).__spike;
      return s.spike.sampleFps(s.map, 5000);
    });
  };
  // Interleave baseline/effect so drift on a loaded box hits both.
  // `plain` = deck's stock extrusion over the same tiles (no hatch shader):
  // separates the deck/MVT route's cost from the shader's.
  const runs: Record<string, number[]> = { none: [], crosshatch: [], plain: [] };
  for (let i = 0; i < 2; i++) {
    runs.none!.push((await sample("none")).fps);
    runs.crosshatch!.push((await sample("crosshatch")).fps);
    runs.plain!.push((await sample("crosshatch", "&shade=plain")).fps);
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2")!;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
  });
  const features = await page.evaluate(() => {
    const s = (window as any).__spike;
    return s.map.querySourceFeatures("omt", { sourceLayer: "building" }).length;
  });
  const report = {
    renderer,
    buildingFeaturesInSource: features,
    fps: { static: runs.none, effect: runs.crosshatch, deckPlain: runs.plain },
    ratio: mean(runs.crosshatch!) / mean(runs.none!),
    deckPlainRatio: mean(runs.plain!) / mean(runs.none!),
  };
  console.log("[spike] perf", JSON.stringify(report));
  mkdirSync(join(ROOT, "e2e/generated"), { recursive: true });
  writeFileSync(
    join(ROOT, `e2e/generated/spike-crosshatch-perf${process.env.SPIKE_GPU ? "-gpu" : ""}.json`),
    JSON.stringify(report, null, 2)
  );
  expect.soft(report.ratio, "KTD7 budget: effect >= 80% of the static preset").toBeGreaterThanOrEqual(0.8);
});
