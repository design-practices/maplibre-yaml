/**
 * classify: (0.9, ml-6x0) — browser verification, which is also the demo.
 *
 * @remarks
 * The unit suites prove the compiled expressions against MapLibre's own
 * evaluator; only a real map proves the reader sees them: classes drawn in
 * their colours at known features, computed breaks landing when a fetched
 * source arrives, no-data features GREY rather than the black MapLibre
 * paints when a `step` input is null or a string, graduated circles sized
 * by class, and a legend (map and story) listing real edges.
 *
 * Colours are read from a canvas screenshot at each feature's projected
 * position (gl.readPixels without preserveDrawingBuffer reads black).
 */
import { test, expect, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import { mkdirSync } from "node:fs";

const PAGE = "/examples/verification/18-classify.html";
const STORY = "/examples/verification/story-layout/index.html?doc=classify";

/** Fail on page errors and off-origin requests (hermetic). */
async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    // MapLibre's evaluation failure (the black-fallback path) logs a warning:
    // a classified layer must never produce one.
    if (m.type() === "error" || /Failed to evaluate expression|Falling back to/.test(m.text())) {
      errors.push(`console: ${m.text()}`);
    }
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

type RGB = [number, number, number];

function hex(color: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)!;
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

function near(actual: RGB, expected: RGB, tolerance = 6): boolean {
  return actual.every((v, i) => Math.abs(v - expected[i]!) <= tolerance);
}

/** Canvas pixels at map coordinates (CSS px offsets optional). */
async function sample(page: Page, points: Array<{ at: [number, number]; dx?: number }>): Promise<RGB[]> {
  const positions = await page.evaluate((pts) => {
    const map = (document.getElementById("map") as any).getMap();
    return pts.map((p) => {
      const xy = map.project(p.at);
      return [xy.x + (p.dx ?? 0), xy.y];
    });
  }, points);
  const shot = await page.locator("#map canvas.maplibregl-canvas").screenshot();
  const png = PNG.sync.read(shot);
  const box = await page.locator("#map canvas.maplibregl-canvas").boundingBox();
  const scale = png.width / box!.width;
  return positions.map(([x, y]) => {
    const px = Math.round(x! * scale);
    const py = Math.round(y! * scale);
    const i = (py * png.width + px) * 4;
    return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
  });
}

async function openClassified(page: Page): Promise<{ errors: string[]; classified: Record<string, any> }> {
  const errors = await guard(page);
  await page.addInitScript(() => {
    (window as any).__classified = {};
    document.addEventListener("ml-map:layer-classified", (e: Event) => {
      const d = (e as CustomEvent).detail;
      (window as any).__classified[d.layerId] = d.classify;
    });
  });
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  // The fetched grid computes its breaks when the data lands.
  await page.waitForFunction(() => (window as any).__classified?.grid?.breaks?.length === 2, undefined, {
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => {
      const map = (document.getElementById("map") as any)?.getMap?.();
      if (!map || !map.loaded()) return false;
      return ["grid", "towns", "kinds"].every(
        (id) => (map.queryRenderedFeatures(undefined, { layers: [id] }) ?? []).length > 0
      );
    },
    undefined,
    { timeout: 30_000 }
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const map = (document.getElementById("map") as any).getMap();
        map.once("idle", () => resolve());
        map.triggerRepaint();
      })
  );
  const classified = await page.evaluate(() => (window as any).__classified);
  return { errors, classified };
}

const REDS = ["#fee0d2", "#fc9272", "#de2d26"];
const BLUES = ["#deebf7", "#9ecae1", "#3182bd"];
const NO_DATA = "#cccccc";

test("a choropleth computes quantile breaks from fetched data and paints each class", async ({ page }) => {
  const { errors, classified } = await openClassified(page);
  expect(classified.grid.breaks).toEqual([12, 30]);
  expect(classified.grid.colors).toEqual(REDS);

  // Top row: 5, 12, "15" (a numeric string), 30.
  const top = await sample(page, [
    { at: [0.5, 0.5] },
    { at: [1.5, 0.5] },
    { at: [2.5, 0.5] },
    { at: [3.5, 0.5] },
  ]);
  const want = [REDS[0], REDS[1], REDS[1], REDS[2]].map((c) => hex(c!));
  top.forEach((rgb, i) => expect(near(rgb, want[i]!), `cell A${i + 1}: ${rgb} vs ${want[i]}`).toBe(true));

  // Bottom row: null, missing, "n/a" → grey, NOT black; 50 → top class.
  const bottom = await sample(page, [{ at: [0.5, 1.5] }, { at: [1.5, 1.5] }, { at: [2.5, 1.5] }, { at: [3.5, 1.5] }]);
  for (let i = 0; i < 3; i++) {
    expect(near(bottom[i]!, hex(NO_DATA)), `cell B${i + 1}: ${bottom[i]} should be no-data grey`).toBe(true);
    expect(near(bottom[i]!, [0, 0, 0], 30), `cell B${i + 1} is black`).toBe(false);
  }
  expect(near(bottom[3]!, hex(REDS[2]!))).toBe(true);

  mkdirSync("e2e/screenshots", { recursive: true });
  await page.screenshot({ path: "e2e/screenshots/classify-map.png" });
  expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
});

test("graduated circles take their class colour and radius; categories their match colour", async ({ page }) => {
  const { errors } = await openClassified(page);
  // Centres: pop 500, 5000, "20000", null.
  const centres = await sample(page, [{ at: [0.5, -1] }, { at: [1.5, -1] }, { at: [2.5, -1] }, { at: [3.5, -1] }]);
  [BLUES[0], BLUES[1], BLUES[2], NO_DATA].forEach((c, i) =>
    expect(near(centres[i]!, hex(c!)), `town ${i}: ${centres[i]} vs ${c}`).toBe(true)
  );
  // 11px right of centre: inside the 13px circle, outside the 5px one.
  const rims = await sample(page, [{ at: [2.5, -1], dx: 11 }, { at: [0.5, -1], dx: 11 }]);
  expect(near(rims[0]!, hex(BLUES[2]!))).toBe(true);
  expect(near(rims[1]!, hex("#cfe8c9"))).toBe(true); // the background

  const kinds = await sample(page, [{ at: [0.5, -2] }, { at: [1.5, -2] }, { at: [2.5, -2] }, { at: [3.5, -2] }]);
  ["#1b9e77", "#d95f02", "#7570b3", NO_DATA].forEach((c, i) =>
    expect(near(kinds[i]!, hex(c)), `kind ${i}: ${kinds[i]} vs ${c}`).toBe(true)
  );
  expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
});

test("the legend lists each classified layer with real class edges", async ({ page }) => {
  const { errors } = await openClassified(page);
  const legend = page.locator(".ml-map-legend");
  await expect(legend).toBeVisible();
  const lines = await legend.locator(".legend-heading, .legend-label").allTextContents();
  expect(lines).toEqual([
    "Value",
    "5–12",
    "12–30",
    "30–50",
    "No data",
    "Population",
    "500–1,000",
    "1,000–10,000",
    "10,000–20,000",
    "No data",
    "Kind",
    "a",
    "b",
    "Other",
    "No data",
  ]);
  // Graduated swatches grow with the class.
  const sizes = await legend
    .locator(".legend-item .legend-symbol.circle")
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).getBoundingClientRect().width));
  expect(sizes.slice(0, 3)).toEqual([10, 18, 26]);
  await legend.screenshot({ path: "e2e/screenshots/classify-legend.png" });
  expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
});

test("a story's pinned legend shows the classes its map computed", async ({ page }) => {
  const errors = await guard(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(STORY, { waitUntil: "domcontentloaded" });
  const panel = page.locator(".scrolly-legend-panel");
  await expect(panel).toContainText("5–12", { timeout: 60_000 });
  const lines = await panel.locator(".legend-heading, .legend-label").allTextContents();
  expect(lines).toEqual(["Value", "5–12", "12–30", "30–50", "No data"]);
  await page.screenshot({ path: "e2e/screenshots/classify-story.png" });
  expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
});
