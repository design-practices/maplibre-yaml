/**
 * U12 SPIKE — hatch-fill on @deck.gl/maplibre MapLibreOverlay (interleaved).
 *
 * @remarks
 * EVIDENCE, NOT PRODUCT (plan U12, ml-rzm). Drives
 * packages/spike-deck-hatch/page/index.html — the U10 crosshatch preset
 * document progressively enhanced by a deck HatchLayer via an `x-effect`
 * extension block (no core schema; AE4) — through the four contract points:
 *
 *  1. renders interleaved with beforeId (below "labels": a red line layer
 *     above the hatch stays unhatched) — and the silent-failure/overlaid
 *     modes that break it, recorded;
 *  2. params drive uniforms (angle / spacing / color);
 *  3. absence of the runtime → the static preset (emit path, lossy warning,
 *     fallback(params) pixel-equal to the document's static tile);
 *  4. KTD7: rAF sampler with harness validity (heavy synthetic falls well
 *     below baseline, light stays within), effect vs baseline; static
 *     params → zero triggerRepaint; teardown → zero rAF.
 *
 * Numbers are logged (and written to e2e/generated/spike-perf.json). CI and
 * local runs use SwiftShader software GL — ratios are the budget, absolute
 * fps mostly measure the runner (KTD7).
 */
import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const ROOT = process.cwd();
const SPIKE_DIR = join(ROOT, "packages/spike-deck-hatch");
const DEGRADE_DIR = join(ROOT, "e2e/generated/spike-degrade");
const DEGRADE_URL = "http://localhost:4174/e2e/generated/spike-degrade";
const PAGE = "/packages/spike-deck-hatch/page/index.html";

// SPIKE_GPU=1 runs on the host GPU via ANGLE/Vulkan (KTD7's real-hardware
// numbers for the bead); default is the suite's SwiftShader software GL.
if (process.env.SPIKE_GPU) {
  test.use({
    launchOptions: {
      args: ["--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist", "--enable-gpu"],
    },
  });
}

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
    errors.push(`external request: ${url}`);
    return route.abort();
  });
  return errors;
}

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`${PAGE}?${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (window as any).__spike, undefined, { timeout: 60_000 });
  await settle(page);
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__spike.spike.idle((window as any).__spike.map));
}

/** Red "labels" pixels and blue ink darkness in the map element's screenshot. */
async function measure(page: Page): Promise<{ red: number; ink: number; png: Buffer }> {
  const png = await page.locator("#map").screenshot();
  const img = PNG.sync.read(png);
  let red = 0;
  let ink = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const [r, g, b] = [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
    if (r > 200 && g < 90 && b < 100) red++;
    if (b > r) ink += Math.max(0, 218 - (0.299 * r + 0.587 * g + 0.114 * b));
  }
  return { red, ink, png };
}

test.beforeAll(() => {
  execFileSync("pnpm", ["--filter", "@maplibre-yaml/spike-deck-hatch", "bundle"], {
    cwd: ROOT,
    stdio: "pipe",
  });
  execFileSync(
    "node",
    ["--import", "tsx", "../spike-deck-hatch/scripts/emit-degrade.ts", DEGRADE_DIR, DEGRADE_URL],
    { cwd: join(ROOT, "packages/cli"), stdio: "pipe" }
  );
});

test.describe("U12 spike: deck hatch-fill", () => {
  test("1. renders interleaved in the static layer's slot, below labels", async ({ page }) => {
    const errors = await guard(page);

    await open(page, "fx=none");
    const base = await measure(page);

    await open(page, "fx=interleaved");
    const inter = await page.evaluate(() => ({
      placementOk: (window as any).__spike.handle.placementOk,
      order: (window as any).__spike.map.getLayersOrder(),
    }));
    const fx = await measure(page);
    console.log("[spike] interleaved order:", inter.order.join(" > "));
    expect(inter.placementOk).toBe(true);
    const o = inter.order as string[];
    expect(o.indexOf("deck-maplibre-layer-group-before:crosshatch-outline")).toBeLessThan(
      o.indexOf("labels-proxy")
    );
    expect(o.indexOf("deck-maplibre-layer-group-before:crosshatch-dark")).toBeGreaterThan(
      o.indexOf("crosshatch-wash")
    );
    // The label proxy is untouched by the hatch (same red as the static map)…
    expect(Math.abs(fx.red - base.red) / base.red).toBeLessThan(0.03);
    // …and the effect inks the regions.
    expect(fx.ink).toBeGreaterThan(base.ink * 0.5);

    // Recorded failure modes: attaching while the style is not "loaded"
    // makes MapLibreOverlay skip its layer groups SILENTLY (deck then draws
    // after MapLibre's frame — on top of labels). It self-heals only if a
    // later `styledata` event re-resolves the groups (here: the runtime's
    // own setLayoutProperty hide, issued after addControl) …
    await open(page, "fx=interleaved&wait=0");
    const silent = await page.evaluate(() => (window as any).__spike.handle.placementOk);
    const healed = await page.evaluate(() =>
      (window as any).__spike.map
        .getLayersOrder()
        .some((id: string) => id.startsWith("deck-maplibre-layer-group"))
    );
    const silentM = await measure(page);
    // … and overlaid mode is on top by construction (placement loss).
    await open(page, "fx=overlaid");
    const over = await measure(page);
    console.log(
      `[spike] red label-proxy px: static=${base.red} interleaved=${fx.red} ` +
        `interleaved-unloaded=${silentM.red} (placementOk at attach=${silent}, ` +
        `groups after settle=${healed}) overlaid=${over.red}`
    );
    console.log(`[spike] ink: static=${Math.round(base.ink)} interleaved=${Math.round(fx.ink)}`);
    expect(silent).toBe(false);
    expect(over.red).toBeLessThan(base.red * 0.97);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("2. params drive uniforms (angle, spacing, color)", async ({ page }) => {
    const errors = await guard(page);
    await open(page, "fx=interleaved");
    const a = await measure(page);

    const set = async (patch: Record<string, unknown>) => {
      await page.evaluate((p) => {
        const s = (window as any).__spike;
        s.handle.setParams("crosshatch-light", p);
        s.handle.setParams("crosshatch-dark", p);
      }, patch);
      await settle(page);
      return measure(page);
    };

    const rotated = await set({ angle: 20 });
    expect(rotated.png.equals(a.png), "angle change did not change pixels").toBe(false);
    const sparse = await set({ angle: 45, spacing: 16 });
    const ratio = sparse.ink / a.ink;
    console.log(`[spike] spacing 8→16 ink ratio ${ratio.toFixed(3)}`);
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.85);
    const recolored = await set({ spacing: 8, color: [230, 57, 70, 255] });
    console.log(`[spike] red px after color→red: ${recolored.red} (was ${a.red})`);
    expect(recolored.red).toBeGreaterThan(a.red * 2);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("3. no runtime → the static preset via emit (lossy, fallback == static tile)", async ({
    page,
  }) => {
    const result = JSON.parse(readFileSync(join(DEGRADE_DIR, "result.json"), "utf8"));
    expect(result.strictRefused).toBe(true);
    expect(result.lossy.map((w: { path: string }) => w.path)).toEqual([
      "layers.crosshatch-light.x-effect",
      "layers.crosshatch-dark.x-effect",
    ]);
    expect(result.xEffectStripped).toBe(true);
    expect(result.fallbackChecks.every((c: { pixelsEqual: boolean }) => c.pixelsEqual)).toBe(true);

    const errors = await guard(page);
    await page.goto("/e2e/generated/spike-degrade/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => {
        const map = (window as any).__eject?.map;
        return (
          map?.isStyleLoaded?.() &&
          map.queryRenderedFeatures(undefined, { layers: ["crosshatch-dark"] }).length > 0
        );
      },
      undefined,
      { timeout: 60_000 }
    );
    const images = await page.evaluate(() =>
      ["mlym:hatch-light", "mlym:hatch-dark"].map((n) => (window as any).__eject.map.hasImage(n))
    );
    expect(images).toEqual([true, true]);
    const m = await measure(page);
    expect(m.ink).toBeGreaterThan(1_000_000);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("4a. KTD7 static clause: no triggerRepaint while static; teardown leaks no rAF", async ({
    page,
  }) => {
    const errors = await guard(page);
    await open(page, "fx=interleaved");
    const quiet = async () => {
      await page.evaluate(() => (window as any).__spike.counters.reset());
      await page.waitForTimeout(2000);
      return page.evaluate(() => ({
        triggerRepaint: (window as any).__spike.counters.triggerRepaint,
        raf: (window as any).__spike.counters.raf,
      }));
    };
    const attached = await quiet();
    await page.evaluate(() => (window as any).__spike.detach());
    await settle(page);
    const detached = await quiet();
    console.log(
      `[spike] 2s idle — attached: repaint=${attached.triggerRepaint} raf=${attached.raf}; ` +
        `after destroy: repaint=${detached.triggerRepaint} raf=${detached.raf}`
    );
    expect(attached.triggerRepaint).toBe(0);
    expect(detached.triggerRepaint).toBe(0);
    expect(detached.raf).toBe(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("4b. KTD7 perf: harness validity + effect vs same-run baseline (10k features)", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const errors = await guard(page);
    await open(page, "fx=none&data=grid");

    const sample = (kind: "plain" | "animated") =>
      page.evaluate(async (k) => {
        const s = (window as any).__spike;
        const onFrame =
          k === "animated"
            ? (t: number) => {
                for (const slot of s.handle.slots)
                  s.handle.setParams(slot.layerId, {}, { phase: t * 12 });
              }
            : undefined;
        return s.spike.sampleFps(s.map, 5000, onFrame);
      }, kind);
    const heavy = (n: number) =>
      page.evaluate(async (h) => {
        const s = (window as any).__spike;
        for (const slot of s.handle.slots) s.handle.setParams(slot.layerId, {}, { heavy: h, phase: 0 });
        await s.spike.idle(s.map);
      }, n);

    const renderer = await page.evaluate(() => {
      const gl = (window as any).__spike.map.painter.context.gl as WebGL2RenderingContext;
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    });
    const setStatic = (v: "visible" | "none") =>
      page.evaluate(async (vis) => {
        const s = (window as any).__spike;
        for (const id of ["crosshatch-light", "crosshatch-dark"])
          s.map.setLayoutProperty(id, "visibility", vis);
        await s.spike.idle(s.map);
      }, v);

    const results: Record<string, { fps: number; renders: number; rafTicks: number }> = {};
    results["baseline"] = await sample("plain");
    // A second reference: no hatch at all (wash + outline only).
    await setStatic("none");
    results["bare-no-hatch"] = await sample("plain");
    await setStatic("visible");
    await page.evaluate(() => (window as any).__spike.attach("interleaved"));
    await settle(page);
    results["effect-static"] = await sample("plain");
    results["effect-animated"] = await sample("animated");
    await heavy(16);
    results["synthetic-light"] = await sample("plain");
    await heavy(2048);
    results["synthetic-heavy"] = await sample("plain");
    await page.evaluate(() => (window as any).__spike.detach());
    await settle(page);
    results["baseline-after"] = await sample("plain");

    const base = (results["baseline"]!.fps + results["baseline-after"]!.fps) / 2;
    const ratios = Object.fromEntries(
      Object.entries(results).map(([k, v]) => [k, +(v.fps / base).toFixed(3)])
    );
    const report = { renderer, baselineMeanFps: base, results, ratios };
    console.log("[spike] perf", JSON.stringify(report, null, 2));
    mkdirSync(join(ROOT, "e2e/generated"), { recursive: true });
    writeFileSync(
      join(ROOT, `e2e/generated/spike-perf${process.env.SPIKE_GPU ? "-gpu" : ""}.json`),
      JSON.stringify(report, null, 2)
    );

    // Harness validity (plan U12): the sampler must be able to see a miss.
    expect.soft(ratios["synthetic-heavy"]!, "heavy synthetic not detected").toBeLessThan(0.5);
    expect.soft(ratios["synthetic-light"]!, "light synthetic flagged").toBeGreaterThanOrEqual(0.8);
    // KTD7: animated effect ≥ 80% of the same-run no-effect mean.
    expect.soft(ratios["effect-animated"]!, "KTD7 budget (animated)").toBeGreaterThanOrEqual(0.8);
    expect.soft(ratios["effect-static"]!, "KTD7 budget (static)").toBeGreaterThanOrEqual(0.8);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
