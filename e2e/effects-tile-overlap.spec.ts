/**
 * @maplibre-yaml/effects — no frame draws a tile together with its own
 * ancestor (ml-aot.139).
 *
 * @remarks
 * While a zoom crosses a tile level, MapLibre briefly keeps the old parent
 * tile on screen beside its loaded children (maplibre-gl 6 slices make the
 * two canonical zooms differ; v5 overzoom holds one canonical tile at two
 * overscaled zooms). The extrusions backend used to draw every one of them
 * whole, so for a few frames the same buildings were drawn twice and
 * z-fought: doubled outlines, mixed hatch — the docs' "flicker on zoom".
 *
 * The spec drives the zoom one rendered frame at a time across tile levels,
 * in and back out, and after every frame compares MapLibre's own visible
 * tiles with the tiles the effect drew:
 *
 *  - with the fix: the effect never draws a tile together with its ancestor
 *    (or one canonical tile twice), including in frames where MapLibre holds
 *    such a pair;
 *  - with the fix switched off (`overlap=0`, the pre-fix behaviour) the count
 *    of overlapping frames is logged for comparison.
 *
 * On a maplibre-gl 4 leg the effect declares absence (the static layer
 * draws), so it draws no tiles at all — the sweep asserts that posture.
 *
 * Set FX_OVERLAP_CAPTURE=<dir> to save the canvas of the first overlapping
 * frames (before) and of the frames where MapLibre held a parent beside its
 * children (after) as PNGs.
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PAGE = "/examples/verification/effects/index.html";
// e2e/server.mjs serves VERIFY_MAPLIBRE_DIR when set (another major, locally)
const MAPLIBRE_DIR = process.env.VERIFY_MAPLIBRE_DIR ?? join(process.cwd(), "node_modules/maplibre-gl");
const VENDOR_MAJOR = Number(JSON.parse(readFileSync(join(MAPLIBRE_DIR, "package.json"), "utf8")).version.split(".")[0]);
const V5 = VENDOR_MAJOR >= 5;
const CAPTURE = process.env.FX_OVERLAP_CAPTURE;

// Small canvas: SwiftShader renders every frame of the sweep (FX_OVERLAP_VIEWPORT=WxH to enlarge, e.g. for captures).
const [VW, VH] = (process.env.FX_OVERLAP_VIEWPORT ?? "640x420").split("x").map(Number);
test.use({ viewport: { width: VW!, height: VH! } });
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

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`${PAGE}?${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (window as any).__fx?.ready, undefined, { timeout: 60_000 });
  await page.evaluate(async () => {
    const s = (window as any).__fx;
    await s.whenEffectsReady();
    await s.idle();
  });
}

interface SweepResult {
  /** Zoom steps on the path (one per rendered frame). */
  steps: number;
  frames: number;
  /** Frames where MapLibre's own visible set held a tile and its ancestor. */
  heldFrames: number;
  /** Frames where the effect DREW a tile and its ancestor. */
  overlapFrames: number;
  /** Frames where the effect skipped tiles another level covered. */
  skippedFrames: number;
  effectActive: boolean;
  firstOverlap?: { zoom: number; drawn: string[] };
  captures: Array<{ frame: number; zoom: number; kind: "overlap" | "held"; drawn: string[]; png: string }>;
}

/**
 * Step the zoom by a fixed amount on every rendered frame, from `from` to
 * each stop in turn, recording MapLibre's visible tiles and the effect's
 * drawn tiles for each frame.
 */
function sweep(page: Page, stops: number[], perLevel: number, capture: boolean): Promise<SweepResult> {
  return page.evaluate(
    async ({ stops, perLevel, capture }) => {
      const s = (window as any).__fx;
      const map = s.map;
      const style = map.style;
      const tm = (style.tileManagers ?? style.sourceCaches).omt;
      const fxe = s.effects()[0];
      type T = { z: number; x: number; y: number; wrap: number };
      const key = (t: T) => `${t.wrap}/${t.z}/${t.x}/${t.y}`;
      const overlaps = (tiles: T[]) => {
        const seen = new Set<string>();
        for (const t of tiles) {
          if (seen.has(key(t))) return true;
          seen.add(key(t));
        }
        return tiles.some((t) => {
          for (let dz = 1; dz <= t.z; dz++) {
            if (seen.has(key({ wrap: t.wrap, z: t.z - dz, x: t.x >> dz, y: t.y >> dz }))) return true;
          }
          return false;
        });
      };
      // the zoom path: fixed step per frame between consecutive stops
      const path: number[] = [];
      for (let i = 1; i < stops.length; i++) {
        const a = stops[i - 1]!, b = stops[i]!;
        const n = Math.max(1, Math.round(Math.abs(b - a) * perLevel));
        for (let k = 1; k <= n; k++) path.push(a + ((b - a) * k) / n);
      }
      map.jumpTo({ zoom: stops[0] });
      await s.idle();
      await s.whenEffectsReady();

      const out = {
        steps: path.length, frames: 0, heldFrames: 0, overlapFrames: 0, skippedFrames: 0,
        effectActive: !!fxe?.active,
        firstOverlap: undefined as undefined | { zoom: number; drawn: string[] },
        captures: [] as Array<{ frame: number; zoom: number; kind: "overlap" | "held"; drawn: string[]; png: string }>,
      };
      await new Promise<void>((resolve) => {
        let step = 0;
        const onRender = () => {
          const ml: T[] = tm.getVisibleCoordinates().map((c: any) => ({ ...c.canonical, wrap: c.wrap }));
          const drawn: T[] = fxe?.handle?.debug?.drawnTiles?.() ?? [];
          const zoom = map.getZoom();
          out.frames++;
          const held = overlaps(ml);
          const overlap = overlaps(drawn);
          if (held) out.heldFrames++;
          if ((fxe?.handle?.stats?.overlapSkipped ?? 0) > 0) out.skippedFrames++;
          const names = drawn.map((t) => `${t.z}/${t.x}/${t.y}`).sort();
          if (overlap) {
            out.overlapFrames++;
            out.firstOverlap ??= { zoom, drawn: names };
          }
          // the drawing buffer is still this frame's until the task ends
          const kind = overlap ? "overlap" : held ? "held" : null;
          if (capture && kind && out.captures.length < 6) {
            out.captures.push({ frame: out.frames, zoom, kind, drawn: names, png: map.getCanvas().toDataURL("image/png") });
          }
          if (step >= path.length) {
            map.off("render", onRender);
            resolve();
            return;
          }
          map.jumpTo({ zoom: path[step++] });
        };
        map.on("render", onRender);
        map.triggerRepaint();
      });
      return out;
    },
    { stops, perLevel, capture }
  );
}

// Cross z14 (real parent/child tiles on every major), then z15 and z16
// (maplibre-gl 6 slices of the z14 source), in and back out.
const STOPS = process.env.FX_STOPS ? process.env.FX_STOPS.split(",").map(Number) : [13.7, 16.4, 14.6];
const PER_LEVEL = Number(process.env.FX_PER_LEVEL ?? 40); // frames per zoom level: 0.025 zoom per frame

function save(result: SweepResult, label: string): void {
  if (!CAPTURE) return;
  const dir = join(CAPTURE, `v${VENDOR_MAJOR}`);
  mkdirSync(dir, { recursive: true });
  for (const c of result.captures) {
    const file = join(dir, `${label}-f${String(c.frame).padStart(3, "0")}-z${c.zoom.toFixed(3)}-${c.kind}.png`);
    writeFileSync(file, Buffer.from(c.png.replace(/^data:image\/png;base64,/, ""), "base64"));
  }
  const { captures: _c, ...summary } = result;
  writeFileSync(join(dir, `${label}-summary.json`), JSON.stringify(summary, null, 2) + "\n");
}

const report = (label: string, r: SweepResult) =>
  console.log(
    `[effects overlap] v${VENDOR_MAJOR} ${label}: ${r.overlapFrames}/${r.frames} frames drew a tile with its ancestor ` +
      `(MapLibre held such a pair in ${r.heldFrames}; the effect skipped a level in ${r.skippedFrames})` +
      (r.firstOverlap ? `; first at z${r.firstOverlap.zoom.toFixed(3)}: ${r.firstOverlap.drawn.join(" ")}` : "")
  );

// crosshatch runs the A/B; blueprint (same backend, other shader) the fix only
for (const [doc, ab] of [["crosshatch", true], ["blueprint", false]] as const) {
  test(`${doc}: zooming across tile levels never draws a tile with its own ancestor`, async ({ page }) => {
    test.setTimeout(300_000);
    const errors = await guard(page);

    // times the sweep met the case: MapLibre holding a parent beside its
    // children, or the effect's own fallback meshes doing the same
    let met = 0;
    if (V5 && ab) {
      // Before (the fix switched off): how often the effect drew both. Logged
      // for comparison, not asserted — it depends on tile-load timing.
      await open(page, `doc=${doc}&overlap=0`);
      const before = await sweep(page, STOPS, PER_LEVEL, !!CAPTURE);
      save(before, `${doc}-before`);
      report(`${doc} before (overlap=0)`, before);
      expect(before.effectActive).toBe(true);
      met += before.heldFrames + before.overlapFrames;
    }

    // After: the fix.
    await open(page, `doc=${doc}`);
    const after = await sweep(page, STOPS, PER_LEVEL, !!CAPTURE);
    save(after, `${doc}-after`);
    report(`${doc} after`, after);
    met += after.heldFrames + after.skippedFrames;
    expect(after.frames).toBeGreaterThan(after.steps);
    expect(after.overlapFrames, `first overlapping frame: ${JSON.stringify(after.firstOverlap)}`).toBe(0);
    if (V5) {
      expect(after.effectActive).toBe(true);
      // The sweep must actually have met the case, else the zero above is
      // vacuous. On v6 it always does (overzoom slices); on v5 it depends on
      // tile-load timing (a fast runner can load every tile in time), so it
      // is only logged there.
      if (VENDOR_MAJOR >= 6) {
        expect(met, "the sweep never met a parent drawn beside its children").toBeGreaterThan(0);
      } else if (met === 0) {
        console.log(`[effects overlap] v${VENDOR_MAJOR} ${doc}: no parent/child frames this run (tiles loaded in time)`);
      }
    } else {
      // maplibre-gl 4: the effect declares absence and draws nothing; the
      // static layer is the map.
      expect(after.effectActive).toBe(false);
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });
}
