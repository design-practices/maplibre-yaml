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
 *  4. export: `--strict` refuses, the static layer ships, and the emitted
 *     style renders in plain maplibre-gl;
 *  5. KTD7's static clause: an idle map with a static effect schedules no
 *     repaint and no frame;
 *  6. live documents (0.10): a changed document applies in place — same
 *     map, the effect stays attached, a reorder keeps the `::fx-` layer
 *     directly above its static layer — while a `mapStyle` change still
 *     yields a new map with the effect re-attached; removal restores the
 *     static layer and leaks no frames;
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

test.describe("effects (maplibre-gl 5+)", () => {
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

  test("4. export: --strict refuses, the static layer ships, and it renders in plain maplibre-gl", async ({ page }) => {
    const errors = await guard(page);
    const out = join(process.cwd(), "e2e/generated/effects-export");
    execFileSync("node", ["--import", "tsx", "scripts/generate-effects-export-fixture.ts", out, ORIGIN], {
      cwd: join(process.cwd(), "packages/cli"),
      stdio: "pipe",
    });
    const result = JSON.parse(readFileSync(join(out, "result.json"), "utf8"));
    expect(result.strictRefused).toBe(true);
    expect(result.strictLossy).toEqual(["layers.buildings.effect"]);
    expect(result.lossy).toEqual(["layers.buildings.effect"]);
    expect(result.effectStripped).toBe(true);
    // The static layer as authored: plain lit walls, no wall pattern.
    expect(result.buildings).toEqual([{ type: "fill-extrusion", pattern: null, color: "#ece6d4" }]);

    await page.goto("/e2e/generated/effects-export/index.html");
    await page.waitForFunction(() => (window as any).__export?.map?.loaded(), undefined, { timeout: 60_000 });
    await page.evaluate(
      () => new Promise((r) => { const m = (window as any).__export.map; m.once("idle", r); m.triggerRepaint(); })
    );
    const rendered = await page.evaluate(
      () => (window as any).__export.map.queryRenderedFeatures(undefined, { layers: ["buildings"] }).length
    );
    console.log(`[effects] exported style renders ${rendered} buildings`);
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

  test("6. teardown: a changed document keeps the map and its effect, a basemap change re-attaches on the new map, removal restores the static layer and leaks no frames", async ({
    page,
  }) => {
    const errors = await guard(page);
    await open(page, "doc=crosshatch");
    // An IDENTICAL config is a no-op (ml-i10, #126): same map, effect still on.
    const equal = await page.evaluate(async () => {
      const s = (window as any).__fx;
      const old = await s.el.mapReady();
      s.el.config = JSON.parse(JSON.stringify(s.doc));
      await new Promise((r) => setTimeout(r, 300));
      const map = await s.el.mapReady();
      return { sameMap: map === old, effects: s.effects().length };
    });
    expect(equal).toEqual({ sameMap: true, effects: 1 });

    /** Where the `::fx-` layer sits relative to its static layer, on the current map. */
    const placement = () =>
      page.evaluate(() => {
        const s = (window as any).__fx;
        const order: string[] = s.el.getMap().getLayersOrder();
        const fx = order.filter((id) => id.includes("::fx-"));
        return {
          fx,
          directlyAbove: fx.map((id) => order[order.indexOf(id) - 1]),
          handles: s.effects().map((e: any) => e.handle?.customLayerId),
        };
      });
    const before = await placement();
    expect(before.fx).toHaveLength(1);
    expect(before.directlyAbove).toEqual(["buildings"]);
    expect(before.handles).toEqual(before.fx);

    // A changed document (live documents, 0.10): a paint edit on another
    // layer applies IN PLACE — same map, the effect still attached and
    // drawing above its static layer.
    const recoloured = await page.evaluate(async () => {
      const s = (window as any).__fx;
      const old = s.el.getMap();
      const next = JSON.parse(JSON.stringify(s.doc));
      next.layers.find((l: any) => l.id === "roads").paint["line-color"] = "#8b0000";
      const outcome = await new Promise<any>((resolve) => {
        s.el.addEventListener("ml-map:update-applied", (e: CustomEvent) => resolve(e.detail), { once: true });
        s.el.config = next;
      });
      await s.whenEffectsReady();
      return {
        sameMap: s.el.getMap() === old,
        propertiesSet: outcome.summary.propertiesSet,
        failures: outcome.summary.failures,
        effects: s.effects().length,
        active: s.effects()[0]?.active,
        roads: s.el.getMap().getPaintProperty("roads", "line-color"),
      };
    });
    expect(recoloured).toEqual({
      sameMap: true,
      propertiesSet: [{ layerId: "roads", property: "line-color" }],
      failures: [],
      effects: 1,
      active: true,
      roads: "#8b0000",
    });
    expect(await placement()).toEqual(before);

    // A reorder that moves the effect-bearing layer below the roads: the
    // `::fx-` layer follows its static layer and stays directly above it.
    const reordered = await page.evaluate(async () => {
      const s = (window as any).__fx;
      const next = JSON.parse(JSON.stringify(s.el.getDocument()));
      const ids = next.layers.map((l: any) => l.id);
      const [roads, buildings] = [ids.indexOf("roads"), ids.indexOf("buildings")];
      [next.layers[roads], next.layers[buildings]] = [next.layers[buildings], next.layers[roads]];
      const outcome = await new Promise<any>((resolve) => {
        s.el.addEventListener("ml-map:update-applied", (e: CustomEvent) => resolve(e.detail), { once: true });
        s.el.config = next;
      });
      await s.whenEffectsReady();
      const order: string[] = s.el.getMap().getLayersOrder();
      return {
        moved: outcome.summary.moved,
        failures: outcome.summary.failures,
        effects: s.effects().length,
        buildingsBelowRoads: order.indexOf("buildings") < order.indexOf("roads"),
      };
    });
    expect(reordered.failures).toEqual([]);
    expect(reordered.moved.length).toBeGreaterThan(0);
    expect(reordered.effects).toBe(1);
    expect(reordered.buildingsBelowRoads).toBe(true);
    const afterReorder = await placement();
    expect(afterReorder.fx).toHaveLength(1);
    expect(afterReorder.directlyAbove).toEqual(["buildings"]);
    expect(afterReorder.handles).toEqual(afterReorder.fx);

    // A mapStyle change still rebuilds: the old map's effect detaches, the
    // new map's attaches (summary.rebuild, ml-map:load again).
    const rebuilt = await page.evaluate(async () => {
      const s = (window as any).__fx;
      const old = s.el.getMap();
      const next = JSON.parse(JSON.stringify(s.el.getDocument()));
      next.config.mapStyle = `${location.origin}/examples/verification/live-update/alt-style.json`;
      const outcome = await new Promise<any>((resolve) => {
        s.el.addEventListener("ml-map:update-applied", (e: CustomEvent) => resolve(e.detail), { once: true });
        s.el.config = next;
      });
      const map = await s.el.mapReady();
      await s.whenEffectsReady();
      return {
        rebuild: outcome.summary.rebuild,
        newMap: map !== old,
        oldEffects: (await import("/packages/effects/dist/index.browser.js")).getAttachedEffects(old).length,
        newEffects: s.effects().length,
        layerOnNewMap: map.getLayersOrder().some((id: string) => id.includes("::fx-")),
      };
    });
    expect(rebuilt).toEqual({ rebuild: true, newMap: true, oldEffects: 0, newEffects: 1, layerOnNewMap: true });

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
