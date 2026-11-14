/**
 * null.earth replica spike (ml-nb1.1) — browser verification, which is also
 * the demo (examples/verification/null-earth/index.html).
 *
 * @remarks
 * Hermetic: GFS frames, Natural Earth coastlines, the particle library and
 * its dependency are all served by e2e/server.mjs; any off-origin request
 * fails the test. What only a real map proves:
 *
 *  1. the YAML half projects a globe with the coastline basemap, and the two
 *     custom layers (temperature under the coastlines, particles on top) sit
 *     in the layer order the page asked for, with no page or console error;
 *  2. the particles move: two captures a moment apart differ over the globe;
 *  3. the temperature overlay paints: hiding it changes the picture;
 *  4. time stepping swaps both layers' sources and the HUD's valid time;
 *  5. the readout samples the grid: a known land point reads a plausible
 *     temperature and wind, and bilinear sampling wraps across the date line;
 *  6. a frame-rate sample is recorded (SwiftShader, so a floor, not a budget);
 *  7. the second engine (mapbox-exif-layer point sprites, `?engine=exif`)
 *     still loads and moves, so the comparison in the spike stays runnable.
 *
 * The default engine is @deltares/webgl-streamline-visualizer's geographic
 * layer, which accumulates particles in a fading trail texture the way
 * null.earth never clears its canvas.
 *
 * The particle layer needs maplibre-gl 5's custom-layer projection data to
 * draw on a globe; on a 4.x matrix leg the whole file is skipped.
 */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const PORT = Number(process.env.VERIFY_PORT ?? 4174);
const ORIGIN = `http://localhost:${PORT}`;
const PAGE = "/examples/verification/null-earth/index.html";
const VENDOR_MAJOR = Number(
  JSON.parse(readFileSync(join(process.cwd(), "node_modules/maplibre-gl/package.json"), "utf8")).version.split(".")[0]
);

test.use({ viewport: { width: 1000, height: 700 } });
test.describe.configure({ mode: "serial" });
test.skip(VENDOR_MAJOR < 5, "globe custom layers need maplibre-gl >= 5");

/** Fail the test on any page error or off-origin request (hermeticity). */
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
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return errors;
}

/**
 * Under SwiftShader the fade-buffer engine's cost scales with particle count
 * (each slow frame widens dt, which multiplies its sub-steps), so the spec
 * runs it with a fifth of the page's default count: ~4 fps instead of ~0.7,
 * and the suite in about a minute instead of six. Nothing asserted depends
 * on the count.
 */
const SPEC_COUNT = 700;

async function open(page: Page, query = ""): Promise<string[]> {
  const errors = await guard(page);
  const q = new URLSearchParams(query.replace(/^\?/, ""));
  if (!q.has("count") && q.get("engine") !== "exif") q.set("count", String(SPEC_COUNT));
  await page.goto(`${ORIGIN}${PAGE}?${q}`);
  await page.waitForSelector("html[data-ready='1']", { timeout: 60_000 });
  // Let the particle layer load its texture and draw a few frames.
  await page.waitForFunction(() => {
    const m = (window as any).__nullEarth.map;
    return m.loaded() && m.getLayer("wind-particles") && m.getLayer("temp-overlay");
  });
  await page.waitForTimeout(1500);
  return errors;
}

/** Count pixels that differ between two PNG captures by more than `tol` in any channel. */
function diffPixels(a: Buffer, b: Buffer, tol = 24): number {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  expect(pa.width).toBe(pb.width);
  let n = 0;
  for (let i = 0; i < pa.data.length; i += 4) {
    if (
      Math.abs(pa.data[i] - pb.data[i]) > tol ||
      Math.abs(pa.data[i + 1] - pb.data[i + 1]) > tol ||
      Math.abs(pa.data[i + 2] - pb.data[i + 2]) > tol
    )
      n++;
  }
  return n;
}

const shot = (page: Page) => page.locator("ml-map canvas.maplibregl-canvas").first().screenshot();

test("1 globe + coastlines from YAML, particle and overlay layers in order, no errors", async ({ page }, info) => {
  const errors = await open(page);
  const s = await page.evaluate(() => {
    const { map } = (window as any).__nullEarth;
    return {
      projection: map.getProjection()?.type,
      order: map.getLayersOrder() as string[],
      windType: map.getLayer("wind-particles")?.type,
      tempType: map.getLayer("temp-overlay")?.type,
    };
  });
  expect(s.projection).toBe("globe");
  expect(s.windType).toBe("custom");
  expect(s.tempType).toBe("custom");
  const i = (id: string) => s.order.indexOf(id);
  expect(i("ocean")).toBeGreaterThanOrEqual(0);
  expect(i("temp-overlay")).toBeGreaterThan(i("ocean"));
  expect(i("coastline")).toBeGreaterThan(i("temp-overlay"));
  expect(i("wind-particles")).toBeGreaterThan(i("coastline"));
  await info.attach("null-earth-globe.png", { body: await shot(page), contentType: "image/png" });
  expect(errors).toEqual([]);
});

test("2 the particles move", async ({ page }) => {
  const errors = await open(page, "?overlay=off");
  const a = await shot(page);
  await page.waitForTimeout(700);
  const b = await shot(page);
  const moved = diffPixels(a, b);
  console.log(`[null-earth] particle pixels changed between captures: ${moved}`);
  expect(moved).toBeGreaterThan(300);
  expect(errors).toEqual([]);
});

test("3 the temperature overlay paints", async ({ page }) => {
  const errors = await open(page);
  // Freeze the particles so the only difference is the overlay.
  await page.evaluate(() => (window as any).__nullEarth.map.setLayoutProperty("wind-particles", "visibility", "none"));
  await page.waitForTimeout(400);
  const on = await shot(page);
  await page.selectOption("#overlay", "off");
  await page.waitForTimeout(400);
  const off = await shot(page);
  const changed = diffPixels(on, off);
  console.log(`[null-earth] overlay pixels: ${changed}`);
  expect(changed).toBeGreaterThan(20_000);
  expect(errors).toEqual([]);
});

test("4 time stepping swaps both sources and the valid time", async ({ page }) => {
  const errors = await open(page);
  const before = await page.locator("#valid").textContent();
  const calls: string[] = [];
  await page.exposeFunction("__recordSource", (s: string) => calls.push(s));
  await page.evaluate(() => {
    const ne = (window as any).__nullEarth;
    const orig = ne.temp.setSource.bind(ne.temp);
    ne.temp.setSource = (url: string, ...rest: unknown[]) => {
      (window as any).__recordSource(url);
      return orig(url, ...rest);
    };
  });
  await page.click("#next");
  await expect(page.locator("#valid")).not.toHaveText(before!);
  await expect(page.locator("#valid")).toContainText("+3 h");
  expect(calls.some((u) => u.includes("f003-temp-2m.png"))).toBe(true);
  // The wind engine received the new frame too (either engine logs it).
  await expect.poll(() => page.evaluate(() => (window as any).__nullEarth.windFrames.at(-1))).toContain("f003-wind-10m.png");
  await page.waitForTimeout(800);
  expect(errors).toEqual([]);
});

test("5 the readout samples the grid (plausible values, date-line wrap)", async ({ page }) => {
  const errors = await open(page);
  const r = await page.evaluate(async () => {
    const { readout } = (window as any).__nullEarth;
    return {
      sahara: await readout({ lng: 10, lat: 25 }),
      antarctica: await readout({ lng: 90, lat: -80 }),
      westOfLine: await readout({ lng: 179.9, lat: 0 }),
      eastOfLine: await readout({ lng: -179.9, lat: 0 }),
    };
  });
  // Mid-November: the Sahara is warmer than the Antarctic plateau by a wide margin.
  expect(r.sahara.kelvin).toBeGreaterThan(280);
  expect(r.antarctica.kelvin).toBeLessThan(265);
  expect(r.sahara.kelvin - r.antarctica.kelvin).toBeGreaterThan(30);
  for (const v of Object.values(r) as Array<{ speed: number }>) {
    expect(v.speed).toBeGreaterThanOrEqual(0);
    expect(v.speed).toBeLessThan(40);
  }
  // 0.2° apart across the date line: the bilinear sample is continuous.
  expect(Math.abs(r.westOfLine.kelvin - r.eastOfLine.kelvin)).toBeLessThan(2);
  // Hovering fills the HUD.
  const box = (await page.locator("ml-map canvas.maplibregl-canvas").first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("#wind")).toContainText("m/s");
  await expect(page.locator("#temp")).toContainText("°C");
  expect(errors).toEqual([]);
});

test("6 frame-rate sample (SwiftShader floor, recorded not asserted)", async ({ page }, info) => {
  const errors = await open(page);
  const fps = await page.evaluate(() => (window as any).__nullEarth.sampleFps(3000));
  console.log(`[null-earth] ${fps.toFixed(1)} fps with particles animating (SwiftShader, software GL)`);
  await info.attach("fps.txt", { body: `${fps.toFixed(1)} fps`, contentType: "text/plain" });
  expect(fps).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("7 the point-sprite engine (?engine=exif) still loads and moves", async ({ page }) => {
  const errors = await open(page, "?engine=exif&overlay=off");
  const engine = await page.evaluate(() => (window as any).__nullEarth.engine);
  expect(engine).toBe("exif");
  const a = await shot(page);
  await page.waitForTimeout(700);
  const b = await shot(page);
  const moved = diffPixels(a, b);
  console.log(`[null-earth] exif engine pixels changed: ${moved}`);
  expect(moved).toBeGreaterThan(300);
  expect(errors).toEqual([]);
});
