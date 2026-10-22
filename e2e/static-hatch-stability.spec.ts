/**
 * The static crosshatch (gallery page, and what `mlym emit` exports) at
 * devicePixelRatio 2 — hatch stability (ml-aot.139).
 *
 * @remarks
 * Plain style-spec patterns, no effect. MapLibre samples its pattern atlas
 * bilinearly with NO mipmaps, so any pattern drawn minified aliases: thin
 * strokes break into dots and crawl as the map moves. The document is built
 * around that (variant E of the static-crosshatch comparison):
 *
 *  1. Density: the ground hatches are 512 px declared at `pixelRatio: 2` —
 *     pre-filtered by `mlym bake crosshatch` (2x Tangram's period, soft
 *     strokes). On a DPR-2 screen they reach MapLibre as declared; on a
 *     DPR-1 screen `<ml-map>` hands MapLibre the image resampled to the
 *     screen's ratio, the pixels the exported @1x sprite carries.
 *  2. No wall pattern: walls are sampled edge-on, the worst minification on
 *     screen, so the buildings are plain lit extrusions. At pitch 60 the
 *     frame (ground hatch and buildings) must sit at the aliasing floor:
 *     close to the same camera rendered 8x supersampled and box-filtered
 *     down, i.e. what a mipmapped renderer would show.
 *  3. Stability across an integer zoom: MapLibre rescales a pattern 2x at
 *     each integer zoom and cross-fades the two scales over `fadeDuration`.
 *     Driven frame by frame on a 60 fps clock (`setNow`), a slow zoom across
 *     z16 must show no frame where the hatch jumps: each frame must match
 *     the previous one scaled by the camera's zoom step (motion-compensated
 *     residual), within a small factor of the sweep's typical residual.
 *
 * Hermetic: the gallery twin (examples/gallery/configs/crosshatch.yaml).
 */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const MAPLIBRE_DIR = process.env.VERIFY_MAPLIBRE_DIR ?? join(process.cwd(), "node_modules/maplibre-gl");
const VENDOR_MAJOR = Number(JSON.parse(readFileSync(join(MAPLIBRE_DIR, "package.json"), "utf8")).version.split(".")[0]);

test.use({ viewport: { width: 480, height: 400 }, deviceScaleFactor: 2 });

async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || /^(data|blob):/.test(url)) return route.continue();
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return errors;
}

async function open(page: Page): Promise<void> {
  await page.goto("/examples/gallery/viewer.html?example=crosshatch", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => {
      const map = (document.getElementById("map") as any)?.getMap?.();
      return !!map?.isStyleLoaded?.() && !!map.getLayer("buildings") && map.hasImage("earth") && map.hasImage("landuse");
    },
    undefined,
    { timeout: 60_000 }
  );
}

function luminance(png: PNG): Float32Array {
  const out = new Float32Array(png.width * png.height);
  for (let i = 0; i < out.length; i++) {
    out[i] = 0.299 * png.data[i * 4]! + 0.587 * png.data[i * 4 + 1]! + 0.114 * png.data[i * 4 + 2]!;
  }
  return out;
}

/**
 * Mean |Δ luminance| between frame b and frame a scaled by 2^(zb − za)
 * about the canvas centre (a flat zoom about the centre is exactly that
 * scale), over the central 60 % of the canvas.
 */
function residual(a: Float32Array, b: Float32Array, w: number, h: number, scale: number): number {
  const cx = w / 2, cy = h / 2;
  let sum = 0, n = 0;
  for (let y = Math.floor(h * 0.2); y < h * 0.8; y++) {
    for (let x = Math.floor(w * 0.2); x < w * 0.8; x++) {
      const sx = cx + (x - cx) / scale, sy = cy + (y - cy) / scale;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      const i = y0 * w + x0;
      const v = (a[i]! * (1 - fx) + a[i + 1]! * fx) * (1 - fy) + (a[i + w]! * (1 - fx) + a[i + w + 1]! * fx) * fy;
      sum += Math.abs(b[y * w + x]! - v);
      n++;
    }
  }
  return sum / n;
}

/** One registered image as MapLibre holds it. */
const imageState = (page: Page, name: string) =>
  page.evaluate((n) => {
    const style = (document.getElementById("map") as any).getMap().style;
    const image = style.getImage?.(n) ?? style.imageManager?.getImage?.(n);
    return { dpr: devicePixelRatio, width: image?.data?.width, pixelRatio: image?.pixelRatio };
  }, name);

test("the ground hatch reaches MapLibre as declared, and the buildings carry no pattern", async ({ page }) => {
  const errors = await guard(page);
  await open(page);
  // earth.png / landuse.png are 512 px at pixelRatio 2 (256 CSS px); DPR 2 needs no resample
  expect(await imageState(page, "earth")).toEqual({ dpr: 2, width: 512, pixelRatio: 2 });
  expect(await imageState(page, "landuse")).toEqual({ dpr: 2, width: 512, pixelRatio: 2 });
  const buildings = await page.evaluate(() => {
    const map = (document.getElementById("map") as any).getMap();
    return {
      pattern: map.getPaintProperty("buildings", "fill-extrusion-pattern") ?? null,
      color: map.getPaintProperty("buildings", "fill-extrusion-color"),
      gradient: map.getPaintProperty("buildings", "fill-extrusion-vertical-gradient"),
      wallImage: map.hasImage("building-hatch"),
    };
  });
  expect(buildings).toEqual({ pattern: null, color: "#ece6d4", gradient: true, wallImage: false });
  expect(errors, errors.join("\n")).toEqual([]);
});

test.describe("on a DPR-1 screen", () => {
  test.use({ deviceScaleFactor: 1 });
  test("the ground hatch is resampled to the screen's pixel ratio, not drawn minified from its declared 2", async ({ page }) => {
    const errors = await guard(page);
    await open(page);
    // 512 px at pixelRatio 2 → 256 px at ratio 1: same size on the map, no minification
    expect(await imageState(page, "earth")).toEqual({ dpr: 1, width: 256, pixelRatio: 1 });
    expect(await imageState(page, "landuse")).toEqual({ dpr: 1, width: 256, pixelRatio: 1 });
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test("pitch 60: the ground hatch and the buildings sit at the aliasing floor (DPR 2, vs 8x supersampled)", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await guard(page);
  await open(page);
  const bands = await page.evaluate(async () => {
    const map = (document.getElementById("map") as any).getMap();
    const idle = () => new Promise<void>((r) => { map.once("idle", () => r()); map.triggerRepaint(); });
    for (const l of map.getStyle().layers) if (l.type === "symbol") map.setLayoutProperty(l.id, "visibility", "none");
    map.jumpTo({ center: [-74.0118, 40.7075], zoom: 15.9, pitch: 60, bearing: 29 });
    await idle();
    await new Promise((r) => setTimeout(r, 500));
    await idle();
    const canvas: HTMLCanvasElement = map.getCanvas();
    const W = canvas.width, H = canvas.height;
    // Luminance box-filtered onto the device-pixel grid, then a 5-tap
    // binomial blur (about what the eye resolves on a phone: moiré is
    // low-frequency and survives it, sub-pixel resampling noise does not).
    const grab = () =>
      new Promise<Float32Array>((resolve) => {
        map.once("render", () => {
          const c = document.createElement("canvas");
          c.width = canvas.width;
          c.height = canvas.height;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(canvas, 0, 0);
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          const f = c.width / W;
          const lum = new Float32Array(W * H);
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            let s = 0;
            for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) {
              const p = ((y * f + j) * c.width + x * f + i) * 4;
              s += 0.299 * d[p]! + 0.587 * d[p + 1]! + 0.114 * d[p + 2]!;
            }
            lum[y * W + x] = s / (f * f);
          }
          const k5 = [1, 4, 6, 4, 1], tmp = new Float32Array(W * H), out = new Float32Array(W * H);
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            let s = 0;
            for (let i = -2; i <= 2; i++) s += k5[i + 2]! * lum[y * W + Math.min(W - 1, Math.max(0, x + i))]!;
            tmp[y * W + x] = s / 16;
          }
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            let s = 0;
            for (let i = -2; i <= 2; i++) s += k5[i + 2]! * tmp[Math.min(H - 1, Math.max(0, y + i)) * W + x]!;
            out[y * W + x] = s / 16;
          }
          resolve(out);
        });
        map.triggerRepaint();
      });
    const frame = await grab();
    map._maxCanvasSize = [16384, 16384];
    map.setPixelRatio(devicePixelRatio * 4);
    await idle();
    const ref = await grab();
    map.setPixelRatio(devicePixelRatio);
    const s = [0, 0, 0], n = [0, 0, 0];
    for (let y = 0; y < H; y++) {
      const b = Math.min(2, Math.floor((y / H) * 3));
      for (let x = 0; x < W; x++) { s[b] += Math.abs(frame[y * W + x]! - ref[y * W + x]!); n[b]++; }
    }
    return s.map((v, i) => v / n[i]!);
  });
  console.log(`[static hatch] v${VENDOR_MAJOR} DPR 2 pitch 60 alias far/mid/near: ${bands.map((b) => b.toFixed(2)).join(" / ")}`);
  // Measured (Chromium, SwiftShader): this document 0.62 / 0.56 / 0.68; the
  // previous one — hatched walls, Tangram-period ground — 1.04 / 0.86 / 1.32,
  // its walls alone 1.00 / 0.82 / 1.06. A wall pattern or an unfiltered
  // ground hatch puts a band over the line.
  for (const [i, band] of ["far", "mid", "near"].entries()) {
    expect(bands[i]!, `${band} third aliases`).toBeLessThan(0.82);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a slow zoom across an integer zoom shows no frame where the hatch jumps (DPR 2, 60 fps clock)", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await guard(page);
  await open(page);
  const frames = await page.evaluate(async () => {
    const gl: any = await import("maplibre-gl" as string);
    const lib = gl.setNow ? gl : gl.default;
    if (typeof lib?.setNow !== "function") return null; // maplibre-gl 4 has no clock control
    const map = (document.getElementById("map") as any).getMap();
    const idle = () => new Promise<void>((r) => { map.once("idle", () => r()); map.triggerRepaint(); });
    // flat (a zoom is then an exact scale about the centre); cross z16 between frames, never on it
    map.jumpTo({ center: [-74.0118, 40.7075], zoom: 15.805, pitch: 0, bearing: 0 });
    await idle();
    await new Promise((r) => setTimeout(r, 500));
    await idle();
    let t = performance.now();
    lib.setNow(t);
    const out: Array<{ zoom: number; png: string }> = [];
    await new Promise<void>((resolve) => {
      let k = 0;
      const onRender = () => {
        out.push({ zoom: map.getZoom(), png: map.getCanvas().toDataURL("image/png") });
        if (k >= 30) { map.off("render", onRender); resolve(); return; }
        k++;
        lib.setNow((t += 1000 / 60));
        map.jumpTo({ zoom: 15.805 + 0.02 * k }); // 1.2 zoom levels per second
      };
      map.on("render", onRender);
      map.triggerRepaint();
    });
    lib.restoreNow();
    return out;
  });
  test.skip(frames === null, `maplibre-gl ${VENDOR_MAJOR} exposes no setNow()`);

  const pngs = frames!.map((f) => PNG.sync.read(Buffer.from(f.png.split(",")[1]!, "base64")));
  const lum = pngs.map(luminance);
  const { width: w, height: h } = pngs[0]!;
  const series: Array<[number, number]> = [];
  for (let k = 1; k < frames!.length; k++) {
    series.push([frames![k]!.zoom, residual(lum[k - 1]!, lum[k]!, w, h, 2 ** (frames![k]!.zoom - frames![k - 1]!.zoom))]);
  }
  const sorted = series.map(([, r]) => r).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const worst = series.reduce((m, s) => (s[1] > m[1] ? s : m));
  console.log(
    `[static hatch] v${VENDOR_MAJOR} DPR 2 residual per frame: median ${median.toFixed(1)}, worst ${worst[1].toFixed(1)} at z${worst[0].toFixed(3)} — ` +
      series.map(([z, r]) => `${z.toFixed(2)}:${r.toFixed(1)}`).join(" ")
  );
  expect(frames!.some((f) => f.zoom < 16) && frames!.some((f) => f.zoom > 16)).toBe(true);
  // a hatch pop / flash reads as 2–3x the typical residual; a smooth cross-fade stays near it
  expect(worst[1], `hatch jumped at z${worst[0].toFixed(3)}`).toBeLessThan(median * 1.6);
  expect(errors, errors.join("\n")).toEqual([]);
});
