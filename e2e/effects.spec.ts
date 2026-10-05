/**
 * @maplibre-yaml/effects (U13′, experimental) — browser verification, which
 * is also the demo (examples/verification/effects/index.html).
 *
 * @remarks
 * Hermetic: the lower-Manhattan vector-tile fixture (OpenStreetMap, ODbL)
 * and every texture are served locally; any off-origin request fails the
 * test. What only a real map proves:
 *
 *  1. the effect draws in its static layer's slot — below the labels — and
 *     is not the static fallback;
 *  2. both built-ins render;
 *  3. heights come from the static layer's OWN expressions, on a property
 *     no OpenMapTiles schema has (silhouettes match the static layer);
 *  4. eject: `--strict` refuses, the static layer ships, and the emitted
 *     style renders in plain maplibre-gl;
 *  5. KTD7's static clause: an idle map with a static effect schedules no
 *     repaint and no frame;
 *  6. teardown on re-render and removal restores the static layer and
 *     leaks no frames;
 *  7. the tile-seam fix: walls crossing a tile edge share one
 *     parametrisation in every tile that draws them.
 *
 * On a maplibre-gl 4 matrix leg the backend's feature check fails (no v5
 * custom-layer projection data) and every effect must declare absence with
 * the static layer showing — test 8 pins that; the rest need v5.
 */
import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const PORT = Number(process.env.VERIFY_PORT ?? 4174);
const ORIGIN = `http://localhost:${PORT}`;
const PAGE = "/examples/verification/effects/index.html";
const VENDOR_MAJOR = Number(
  JSON.parse(readFileSync(join(process.cwd(), "node_modules/maplibre-gl/package.json"), "utf8")).version.split(".")[0]
);
const V5 = VENDOR_MAJOR >= 5;

test.use({ viewport: { width: 1000, height: 700 } });
test.describe.configure({ mode: "serial" });

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

/** Open the demo and wait until the map is idle and the effects have built. */
async function open(page: Page, query: string): Promise<void> {
  await page.goto(`${PAGE}?${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (window as any).__fx?.ready, undefined, { timeout: 60_000 });
  await page.evaluate(async () => {
    const s = (window as any).__fx;
    await s.whenEffectsReady();
    await s.idle();
    await new Promise((r) => setTimeout(r, 300));
  });
}

async function shot(page: Page): Promise<PNG> {
  return PNG.sync.read(await page.locator("canvas.maplibregl-canvas").screenshot());
}

/** Share of pixels that are ink (dark strokes). */
function inkShare(img: PNG): number {
  let ink = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i]! < 130 && img.data[i + 1]! < 130 && img.data[i + 2]! < 130) ink++;
  }
  return ink / (img.width * img.height);
}

function differingPixels(a: PNG, b: PNG): number {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.abs(a.data[i]! - b.data[i]!) + Math.abs(a.data[i + 1]! - b.data[i + 1]!) + Math.abs(a.data[i + 2]! - b.data[i + 2]!);
    if (d > 30) n++;
  }
  return n;
}

const effectState = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__fx;
    return {
      order: s.map.getLayersOrder() as string[],
      effects: s.effects().map((e: any) => ({
        layerId: e.layerId,
        type: e.type,
        active: e.active,
        reason: e.reason,
        customLayerId: e.handle?.customLayerId,
        beforeId: e.handle?.beforeId,
        stats: { ...e.handle?.stats },
      })),
    };
  });

test.describe("effects (maplibre-gl 5)", () => {
  test.skip(!V5, `the extrusions backend needs maplibre-gl 5 (vendor is ${VENDOR_MAJOR}); test 8 covers the v4 posture`);

  test("1. tonal-hatch draws in the static layer's slot, below the labels, and is not the fallback", async ({ page }) => {
    const errors = await guard(page);
    await open(page, "doc=crosshatch");
    const { order, effects } = await effectState(page);
    expect(effects).toHaveLength(1);
    const fx = effects[0]!;
    expect(fx).toMatchObject({ layerId: "buildings", type: "tonal-hatch", active: true, beforeId: "place-labels" });
    const at = order.indexOf(fx.customLayerId);
    expect(order[at - 1]).toBe("buildings");
    expect(order[at + 1]).toBe("place-labels");
    expect(fx.stats.placementOk).toBe(1);
    expect(fx.stats.tilesDrawn).toBeGreaterThan(0);
    // the static layer is hidden by opacity (its source stays loaded), not removed
    expect(
      await page.evaluate(() => (window as any).__fx.map.getPaintProperty("buildings", "fill-extrusion-opacity"))
    ).toBe(0);
    const effect = await shot(page);

    await open(page, "doc=crosshatch&fx=0");
    const fallback = await shot(page);
    const inkFx = inkShare(effect), inkStatic = inkShare(fallback);
    console.log(`[effects] ink share: tonal-hatch ${inkFx.toFixed(3)} vs static ${inkStatic.toFixed(3)}`);
    // Lit faces go to paper, shaded faces to dense strokes: a different image
    // with a different ink budget.
    expect(differingPixels(effect, fallback)).toBeGreaterThan(effect.width * effect.height * 0.1);
    expect(Math.abs(inkFx - inkStatic)).toBeGreaterThan(0.01);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("2. blueprint renders and differs from its fallback", async ({ page }) => {
    const errors = await guard(page);
    await open(page, "doc=blueprint");
    const { effects } = await effectState(page);
    expect(effects[0]).toMatchObject({ type: "blueprint", active: true });
    const effect = await shot(page);
    await open(page, "doc=blueprint&fx=0");
    const fallback = await shot(page);
    expect(differingPixels(effect, fallback)).toBeGreaterThan(effect.width * effect.height * 0.05);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("3. heights come from the static layer's own expressions on a non-OpenMapTiles property", async ({ page }) => {
    const errors = await guard(page);
    // flat-ink is registered by the page through the public registerEffect()
    await open(page, "doc=heights");
    const { effects } = await effectState(page);
    expect(effects[0]).toMatchObject({ layerId: "blocks", type: "flat-ink", active: true });
    const mask = (img: PNG) => {
      const m = new Uint8Array(img.width * img.height);
      for (let i = 0; i < m.length; i++) {
        const r = img.data[i * 4]!, g = img.data[i * 4 + 1]!, b = img.data[i * 4 + 2]!;
        m[i] = r < 245 || g < 245 || b < 245 ? 1 : 0; // anything but the white paper
      }
      // ignore the HUD in the bottom-left corner
      for (let y = img.height - 120; y < img.height; y++) for (let x = 0; x < 640; x++) m[y * img.width + x] = 0;
      return m;
    };
    const effect = mask(await shot(page));
    await open(page, "doc=heights&fx=0");
    const fallback = mask(await shot(page));
    let inter = 0, union = 0;
    for (let i = 0; i < effect.length; i++) {
      inter += effect[i]! & fallback[i]!;
      union += effect[i]! | fallback[i]!;
    }
    console.log(`[effects] silhouette IoU effect vs static: ${(inter / union).toFixed(4)} over ${union} px`);
    expect(union).toBeGreaterThan(5000);
    expect(inter / union).toBeGreaterThan(0.97);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("4. eject: --strict refuses, the static layer ships, and it renders in plain maplibre-gl", async ({ page }) => {
    const errors = await guard(page);
    const out = join(process.cwd(), "e2e/generated/effects-eject");
    execFileSync("node", ["--import", "tsx", "scripts/generate-effects-eject-fixture.ts", out, ORIGIN], {
      cwd: join(process.cwd(), "packages/cli"),
      stdio: "pipe",
    });
    const result = JSON.parse(readFileSync(join(out, "result.json"), "utf8"));
    expect(result.strictRefused).toBe(true);
    expect(result.strictLossy).toEqual(["layers.buildings.effect"]);
    expect(result.lossy).toEqual(["layers.buildings.effect"]);
    expect(result.effectStripped).toBe(true);
    expect(result.buildings).toEqual([{ type: "fill-extrusion", pattern: "mlym:building-hatch" }]);

    await page.goto("/e2e/generated/effects-eject/index.html");
    await page.waitForFunction(() => (window as any).__eject?.map?.loaded(), undefined, { timeout: 60_000 });
    await page.evaluate(
      () => new Promise((r) => { const m = (window as any).__eject.map; m.once("idle", r); m.triggerRepaint(); })
    );
    const rendered = await page.evaluate(
      () => (window as any).__eject.map.queryRenderedFeatures(undefined, { layers: ["buildings"] }).length
    );
    console.log(`[effects] ejected style renders ${rendered} buildings`);
    expect(rendered).toBeGreaterThan(500);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("5. an idle map with a static effect schedules no repaint and no frame (KTD7)", async ({ page }) => {
    const errors = await guard(page);
    await open(page, "doc=crosshatch");
    const idle = await page.evaluate(async () => {
      const s = (window as any).__fx;
      s.counters.reset();
      await new Promise((r) => setTimeout(r, 2000));
      return { triggerRepaint: s.counters.triggerRepaint, raf: s.counters.raf };
    });
    console.log(`[effects] idle 2 s: ${JSON.stringify(idle)}`);
    expect(idle.triggerRepaint).toBe(0);
    expect(idle.raf).toBeLessThanOrEqual(2);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("6. teardown: re-render and removal restore the static layer and leak no frames", async ({ page }) => {
    const errors = await guard(page);
    await open(page, "doc=crosshatch");
    // Re-render (a new config): the old map's effect detaches, the new map's attaches.
    const rerender = await page.evaluate(async () => {
      const s = (window as any).__fx;
      const old = s.map;
      s.el.config = s.doc;
      const map = await s.el.mapReady();
      await s.whenEffectsReady();
      return {
        newMap: map !== old,
        oldEffects: (await import("/packages/effects/dist/index.browser.js")).getAttachedEffects(old).length,
        newEffects: s.effects().length,
        layerOnNewMap: map.getLayersOrder().some((id: string) => id.includes("::fx-")),
      };
    });
    expect(rerender).toEqual({ newMap: true, oldEffects: 0, newEffects: 1, layerOnNewMap: true });

    // Detach (what <ml-map> does on destroy) restores the static layer.
    const after = await page.evaluate(async () => {
      const s = (window as any).__fx;
      const map = await s.el.mapReady();
      for (const e of s.effects()) e.detach();
      await new Promise((r) => setTimeout(r, 300));
      const result = {
        opacity: map.getPaintProperty("buildings", "fill-extrusion-opacity"),
        fxLayers: map.getLayersOrder().filter((id: string) => id.includes("::fx-")),
        effects: s.effects().length,
      };
      // Removing the element tears the map down; nothing may keep scheduling frames.
      s.el.remove();
      await new Promise((r) => setTimeout(r, 300));
      s.counters.reset();
      await new Promise((r) => setTimeout(r, 2000));
      return { ...result, raf: s.counters.raf };
    });
    expect(after.opacity).toBeUndefined();
    expect(after.fxLayers).toEqual([]);
    expect(after.effects).toBe(0);
    expect(after.raf).toBeLessThanOrEqual(2);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("7. tile seam: a wall crossing a tile edge has one parametrisation in every tile", async ({ page }) => {
    const errors = await guard(page);
    // A 180 m tower whose 119 m wall crosses the z14 x-boundary at
    // lng -74.00390625: each tile holds a different buffer-cut window of it.
    const camera = "doc=crosshatch&z=17.6&p=45&b=126&lng=-74.00391&lat=40.71311";
    await open(page, camera);
    const report = await page.evaluate(() => {
      const fx = (window as any).__fx.effects()[0];
      return { stats: { ...fx.handle.stats }, groups: fx.handle.debug.seams() };
    });
    const crossTile = report.groups.filter(
      (g: any) => new Set(g.members.map((m: any) => m.meshKey)).size > 1
    );
    console.log(
      `[effects] seams: ${report.stats.seamGroupsResolved} walls known end to end, ${crossTile.length} span tiles, ${report.stats.seamWallsPatched} patched`
    );
    expect(crossTile.length).toBeGreaterThan(10);
    for (const g of crossTile) {
      const ms = [...g.members].sort((a: any, b: any) => a.uA - b.uA);
      // every member patched, one wall length, intervals inside the wall
      for (const m of ms) {
        expect(m.patched).toBe(true);
        expect(m.metres).toBeCloseTo(ms[0].metres, 2);
        expect(m.uA).toBeGreaterThanOrEqual(-0.02);
        expect(m.uB).toBeLessThanOrEqual(1.02);
      }
      // tiles abut at the seam: where one tile's part of the wall ends, the
      // next tile's begins at the same u (no jump, no double coverage)
      for (let i = 1; i < ms.length; i++) {
        if (ms[i].meshKey === ms[i - 1].meshKey) continue;
        expect(Math.abs(ms[i].uA - ms[i - 1].uB)).toBeLessThan(2e-3);
      }
    }
    const stitched = await shot(page);

    // A/B: the spike's per-tile parametrisation draws that face differently.
    await open(page, `${camera}&seams=0`);
    const unstitched = await shot(page);
    const diff = differingPixels(stitched, unstitched);
    console.log(`[effects] seam fix changes ${diff} px at the corner`);
    expect(diff).toBeGreaterThan(5000);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test("8. maplibre-gl 4: every effect declares absence and the static layer stays", async ({ page }) => {
  test.skip(V5, "v4-leg-only: on maplibre-gl 5 the effects draw (tests 1–7)");
  const errors = await guard(page);
  await open(page, "doc=crosshatch");
  const state = await page.evaluate(() => {
    const s = (window as any).__fx;
    return {
      effects: s.effects().map((e: any) => ({ active: e.active, reason: e.reason })),
      opacity: s.map.getPaintProperty("buildings", "fill-extrusion-opacity"),
      fxLayers: (s.map.getStyle().layers as Array<{ id: string }>).filter((l) => l.id.includes("::fx-")).length,
    };
  });
  expect(state.effects[0].active).toBe(false);
  expect(state.effects[0].reason).toMatch(/maplibre-gl 5/);
  expect(state.opacity).toBeUndefined();
  expect(state.fxLayers).toBe(0);
  expect(errors, errors.join("\n")).toEqual([]);
});
