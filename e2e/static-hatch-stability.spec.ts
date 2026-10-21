/**
 * The static crosshatch (gallery page, and what `mlym emit` exports) at
 * devicePixelRatio 2 — hatch stability (ml-aot.139).
 *
 * @remarks
 * Plain style-spec patterns, no effect. Two things only a real map shows:
 *
 *  1. Density: the document declares the building hatch at `pixelRatio: 4`.
 *     MapLibre samples its pattern atlas bilinearly with no mipmaps, so an
 *     image denser than the screen is drawn minified and its thin strokes
 *     alias (break into dots, crawl as the map moves). `<ml-map>` now hands
 *     MapLibre the image resampled to the screen's ratio — the pixels the
 *     exported @2x sprite already carries.
 *  2. Stability across an integer zoom: MapLibre rescales a pattern 2x at
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
      return !!map?.isStyleLoaded?.() && !!map.getLayer("buildings") && map.hasImage("building-hatch");
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

test("the building hatch reaches MapLibre at the screen's pixel ratio, not its declared 4", async ({ page }) => {
  const errors = await guard(page);
  await open(page);
  const img = await page.evaluate(() => {
    const map = (document.getElementById("map") as any).getMap();
    const style = map.style;
    const image = style.getImage?.("building-hatch") ?? style.imageManager?.getImage?.("building-hatch");
    return { dpr: devicePixelRatio, width: image?.data?.width, pixelRatio: image?.pixelRatio };
  });
  // building-fallback.png is 256 px at pixelRatio 4 (64 CSS px); at DPR 2 → 128 px at ratio 2
  expect(img).toEqual({ dpr: 2, width: 128, pixelRatio: 2 });
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
