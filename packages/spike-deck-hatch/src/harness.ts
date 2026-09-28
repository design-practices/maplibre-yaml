/**
 * @file U12 SPIKE — KTD7 perf harness: rAF sampler + repaint/rAF counters
 *
 * @description
 * KTD7's budget is a RATIO: an animated effect must sustain ≥ 80% of the
 * mean frame rate of the identical map without it, over 5-second samples in
 * the same run. MapLibre only renders on demand, so a "frame rate" needs a
 * workload: the sampler drives a continuous camera rotation (one `jumpTo`
 * per rAF) — every tick asks the map for a new frame — and counts the frames
 * the map actually RENDERED (`render` events). A map that keeps up renders
 * once per display refresh; a map that can't falls behind and the count
 * drops. `onFrame` lets an animated effect advance its clock each tick.
 */

import type { Map as MapLibreMap } from "maplibre-gl";

export interface FpsSample {
  ms: number;
  renders: number;
  rafTicks: number;
  fps: number;
}

export function sampleFps(
  map: MapLibreMap,
  ms = 5000,
  onFrame?: (tSeconds: number) => void
): Promise<FpsSample> {
  return new Promise((resolve) => {
    let renders = 0;
    let rafTicks = 0;
    const onRender = () => renders++;
    map.on("render", onRender);
    const start = performance.now();
    const bearing0 = map.getBearing();
    const tick = (now: number) => {
      const elapsed = now - start;
      if (elapsed >= ms) {
        map.off("render", onRender);
        map.jumpTo({ bearing: bearing0 });
        resolve({ ms: elapsed, renders, rafTicks, fps: (renders * 1000) / elapsed });
        return;
      }
      rafTicks++;
      onFrame?.(elapsed / 1000);
      map.jumpTo({ bearing: bearing0 + (elapsed / 1000) * 12 });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export interface Counters {
  triggerRepaint: number;
  raf: number;
  reset(): void;
}

/**
 * Count `map.triggerRepaint` calls and ALL `requestAnimationFrame` calls in
 * the page — the latter is how "teardown leaks no rAF" is observed: after
 * destroy and idle, nobody should still be scheduling frames.
 */
export function installCounters(map: MapLibreMap): Counters {
  const counters: Counters = {
    triggerRepaint: 0,
    raf: 0,
    reset() {
      counters.triggerRepaint = 0;
      counters.raf = 0;
    },
  };
  const origRepaint = map.triggerRepaint.bind(map);
  map.triggerRepaint = () => {
    counters.triggerRepaint++;
    origRepaint();
  };
  const origRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    counters.raf++;
    return origRaf(cb);
  };
  return counters;
}

/** Resolve after the map reports idle (no pending tiles/transitions/frames). */
export function idle(map: MapLibreMap): Promise<void> {
  return new Promise((resolve) => {
    map.once("idle", () => resolve());
    map.triggerRepaint();
  });
}

/**
 * The ≤10k-feature perf dataset (KTD7): a 100×100 grid of small squares
 * across the demo view, alternating dark/light tone — every feature is
 * hatched, statically (fill-pattern) or by the effect.
 */
export function gridFeatures(n = 100) {
  const features = [];
  const [x0, y0, x1, y1] = [4, 42.5, 21, 51.5];
  const dx = (x1 - x0) / n;
  const dy = (y1 - y0) / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = x0 + i * dx;
      const y = y0 + j * dy;
      features.push({
        type: "Feature",
        properties: { tone: (i + j) % 2 === 0 ? "dark" : "light" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [x, y],
              [x + dx * 0.9, y],
              [x + dx * 0.9, y + dy * 0.9],
              [x, y + dy * 0.9],
              [x, y],
            ],
          ],
        },
      });
    }
  }
  return features;
}
