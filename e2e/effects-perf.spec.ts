/**
 * KTD7 performance harness for @maplibre-yaml/effects, re-baselined per
 * Amendment A1 D-A2.
 *
 * @remarks
 * The budget is a RATIO: each effect's frame rate over the same document's
 * static fallback (the same map without the effect), measured in the same
 * run, over 6-second samples of a continuous camera rotation, interleaved
 * so drift on a loaded machine hits both, a fresh browser context per
 * sample. The ≥ 0.8× budget itself is judged on real GPUs (the maintainer's
 * M2 plus a reference machine; record with `EFFECTS_PERF_GPU=1`). CI renders
 * on SwiftShader, where the ratio only means something relative to itself,
 * so CI runs this as a REGRESSION TRIPWIRE: it fails when an effect's ratio
 * drops more than `tolerance` (10%) below its recorded value in
 * e2e/perf-baselines/effects-swiftshader.json.
 *
 *   EFFECTS_PERF_RECORD=1  re-record the SwiftShader baseline (no assertion)
 *   EFFECTS_PERF_GPU=1     real GPU via ANGLE/Vulkan; writes
 *                          e2e/generated/effects-perf-gpu.json (no assertion)
 *   EFFECTS_PERF_ROUNDS=n  paired samples per effect (default 5)
 *   EFFECTS_PERF_SAMPLE_MS=ms  sample length (default 6000)
 *   EFFECTS_PERF_VIEWPORT=WxH  (default 640x400; 1920x1200 with GPU)
 *   EFFECTS_PERF_ENFORCE=1 assert the tripwire outside CI too (CI=true
 *                          always asserts; a loaded developer box makes
 *                          software-GL ratios too noisy to gate on)
 *
 * The reported ratio is the MEDIAN of per-round paired ratios (effect fps /
 * static fps from back-to-back samples), so load drift between rounds
 * cancels instead of compounding.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.VERIFY_PORT ?? 4174);
const ORIGIN = `http://localhost:${PORT}`;
const PAGE = "/examples/verification/effects/index.html";
const VENDOR_MAJOR = Number(
  JSON.parse(readFileSync(join(process.cwd(), "node_modules/maplibre-gl/package.json"), "utf8")).version.split(".")[0]
);
const GPU = !!process.env.EFFECTS_PERF_GPU;
const RECORD = !!process.env.EFFECTS_PERF_RECORD;
const ROUNDS = Number(process.env.EFFECTS_PERF_ROUNDS ?? 5);
const SAMPLE_MS = Number(process.env.EFFECTS_PERF_SAMPLE_MS ?? 6000);
/** The tripwire is a CI gate (D-A2); locally it reports unless asked to enforce. */
const ENFORCE = !!process.env.CI || !!process.env.EFFECTS_PERF_ENFORCE;
// SwiftShader frame time scales with pixels: a small viewport gives many
// more frames per 5 s sample, which is what makes the ratio stable.
const [VW, VH] = (process.env.EFFECTS_PERF_VIEWPORT ?? (GPU ? "1920x1200" : "640x400")).split("x").map(Number);
const VIEWPORT = { width: VW!, height: VH! };
const BASELINE = join(process.cwd(), "e2e/perf-baselines/effects-swiftshader.json");

/** The documents, and the effect each one carries. */
const EFFECTS = [
  { type: "tonal-hatch", doc: "crosshatch" },
  { type: "blueprint", doc: "blueprint" },
] as const;

if (GPU) {
  test.use({
    launchOptions: {
      args: [
        "--use-angle=vulkan",
        "--enable-features=Vulkan",
        "--ignore-gpu-blocklist",
        "--enable-gpu",
        "--disable-gpu-vsync",
        "--disable-frame-rate-limit",
      ],
    },
  });
}

async function hermetic(page: Page): Promise<void> {
  await page.route("**/*", (route) =>
    /^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(route.request().url()) || /^(data|blob):/.test(route.request().url())
      ? route.continue()
      : route.abort()
  );
}

/** One rotating-camera sample in a fresh context. */
async function sample(browser: Browser, query: string): Promise<{ fps: number; lostDuring: number; renderer: string }> {
  const ctx = await browser.newContext({ baseURL: ORIGIN, viewport: VIEWPORT });
  const page = await ctx.newPage();
  await hermetic(page);
  try {
    await page.goto(`${PAGE}?${query}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => (window as any).__fx?.ready, undefined, { timeout: 90_000 });
    return await page.evaluate(async (ms) => {
      const s = (window as any).__fx;
      await s.whenEffectsReady();
      await s.idle();
      const before = s.contextLosses;
      const { fps } = await s.sampleFps(ms);
      const gl = s.map.getCanvas().getContext("webgl2");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      return {
        fps,
        lostDuring: s.contextLosses - before,
        renderer: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown",
      };
    }, SAMPLE_MS);
  } finally {
    await ctx.close();
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

test("KTD7: each effect's frame rate relative to its static fallback (D-A2 tripwire)", async ({ browser }) => {
  test.skip(VENDOR_MAJOR < 5, "the extrusions backend needs maplibre-gl 5");
  test.setTimeout(30 * 60_000);

  let renderer = "unknown";
  const report: Record<string, { staticFps: number[]; effectFps: number[]; ratios: number[]; ratio: number }> = {};
  for (const { type, doc } of EFFECTS) {
    const staticFps: number[] = [];
    const effectFps: number[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      const s = await sample(browser, `doc=${doc}&fx=0`);
      const e = await sample(browser, `doc=${doc}`);
      renderer = e.renderer;
      // a sample across a WebGL context loss is not a measurement
      expect(s.lostDuring + e.lostDuring, "WebGL context lost during a sample").toBe(0);
      staticFps.push(+s.fps.toFixed(2));
      effectFps.push(+e.fps.toFixed(2));
    }
    const ratios = effectFps.map((e, i) => +(e / staticFps[i]!).toFixed(3));
    report[type] = { staticFps, effectFps, ratios, ratio: +median(ratios).toFixed(3) };
  }
  const result = {
    renderer,
    viewport: VIEWPORT,
    rounds: ROUNDS,
    recorded: new Date().toISOString().slice(0, 10),
    effects: report,
  };
  console.log(`[effects-perf] ${JSON.stringify(result)}`);
  mkdirSync(join(process.cwd(), "e2e/generated"), { recursive: true });
  writeFileSync(
    join(process.cwd(), `e2e/generated/effects-perf${GPU ? "-gpu" : ""}-${VW}x${VH}.json`),
    JSON.stringify(result, null, 2)
  );

  if (GPU) return; // real-GPU numbers are the human-judgment input (D-A2), not a CI assertion
  if (RECORD) {
    const baseline = {
      $comment:
        "KTD7 per Amendment A1 D-A2: SwiftShader regression tripwire. An effect fails CI when its " +
        "effect/static frame-rate ratio drops more than `tolerance` below `ratio`. Re-record with " +
        "EFFECTS_PERF_RECORD=1 VERIFY_PORT=<port> pnpm exec playwright test e2e/effects-perf.spec.ts " +
        "after an intended performance change, and say why in the PR.",
      tolerance: 0.1,
      renderer,
      viewport: VIEWPORT,
      recorded: result.recorded,
      effects: Object.fromEntries(Object.entries(report).map(([k, v]) => [k, { ratio: v.ratio, ...v }])),
    };
    mkdirSync(join(process.cwd(), "e2e/perf-baselines"), { recursive: true });
    writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + "\n");
    return;
  }

  const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as {
    tolerance: number;
    effects: Record<string, { ratio: number }>;
  };
  test.skip(!/swiftshader/i.test(renderer), `the tripwire baseline is SwiftShader's; this run rendered on ${renderer}`);
  for (const { type } of EFFECTS) {
    const floor = baseline.effects[type]!.ratio * (1 - baseline.tolerance);
    if (!ENFORCE) {
      if (report[type]!.ratio < floor) {
        console.warn(
          `[effects-perf] ${type}: ratio ${report[type]!.ratio} is below the tripwire floor ${floor.toFixed(3)} ` +
            "(not enforced outside CI; set EFFECTS_PERF_ENFORCE=1 on a quiet machine to gate)"
        );
      }
      continue;
    }
    expect(
      report[type]!.ratio,
      `${type}: effect/static ratio ${report[type]!.ratio} fell more than ${baseline.tolerance * 100}% below its baseline ${baseline.effects[type]!.ratio}`
    ).toBeGreaterThanOrEqual(floor);
  }
});
