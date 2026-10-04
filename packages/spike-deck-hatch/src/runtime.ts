/**
 * @file U12 SPIKE — a minimal effects runtime over MapLibreOverlay (interleaved)
 *
 * @description
 * Models the U13 runtime just far enough to test the contract points, with
 * NO core schema surface (AE4): the effect declaration rides an `x-effect`
 * extension block on an ordinary static layer — the crosshatch preset layer
 * (U10) IS the fallback, and the runtime progressively enhances it:
 *
 *  - finds each layer carrying `x-effect: { type: hatch-fill, ... }`;
 *  - resolves its slot as `beforeId` = the layer directly above it in the
 *    live style (so the deck layer renders exactly where the static layer
 *    did — below labels, above the wash);
 *  - hides the static layer and adds ONE shared MapLibreOverlay for the map
 *    (KTD2: one overlay per map) holding a HatchLayer per effect.
 *
 * Without this runtime, the same document renders the static preset live,
 * and `mlym emit` ejects it (the degrade path; see scripts/emit-degrade.ts).
 */

import { MapLibreOverlay } from "@deck.gl/maplibre";
import type { Map as MapLibreMap } from "maplibre-gl";
import { HatchLayer, type HatchParams } from "./hatch-layer";

export interface EffectDecl {
  type: string;
  angle?: number;
  spacing?: number;
  thickness?: number;
  cross?: boolean;
  color?: string;
}

interface DocLayer {
  id: string;
  source: string;
  filter?: unknown;
  "x-effect"?: EffectDecl;
}

interface Doc {
  sources: Record<string, { data: { features: GeoJSONFeature[] } }>;
  layers: DocLayer[];
}

interface GeoJSONFeature {
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: number[][][] };
}

/** `#rrggbb` → RGBA 0–255. */
function hexToRgba(hex = "#1d3557"): [number, number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

export function toHatchParams(decl: EffectDecl): HatchParams {
  return {
    angle: decl.angle ?? 45,
    spacing: decl.spacing ?? 8,
    thickness: decl.thickness ?? 1.25,
    cross: decl.cross ?? false,
    color: hexToRgba(decl.color),
  };
}

/** Spike-grade filter support: only `["==", ["get", k], v]` (what the doc uses). */
function matches(filter: unknown, f: GeoJSONFeature): boolean {
  if (filter === undefined) return true;
  const [op, getter, value] = filter as [string, [string, string], unknown];
  if (op === "==" && Array.isArray(getter) && getter[0] === "get") {
    return f.properties[getter[1]] === value;
  }
  throw new Error(`[spike] unsupported filter ${JSON.stringify(filter)}`);
}

export interface EffectsHandle {
  overlay: MapLibreOverlay;
  /** Update one effect's params (drives uniforms via setProps). */
  setParams(layerId: string, patch: Partial<HatchParams>, extra?: { phase?: number; heavy?: number }): void;
  /** Layer ids the runtime enhanced, with their resolved beforeId. */
  slots: { layerId: string; beforeId: string | undefined }[];
  /** Interleaved mode only: every effect sits in its deck group below beforeId. */
  placementOk: boolean;
  destroy(): void;
}

export async function attachEffects(
  map: MapLibreMap,
  doc: Doc,
  opts: { interleaved?: boolean; waitForStyle?: boolean } = {}
): Promise<EffectsHandle> {
  const interleaved = opts.interleaved ?? true;
  // FINDING (session 1): MapLibreOverlay resolves its interleaved layer
  // groups only when map.isStyleLoaded() — otherwise it SILENTLY skips them,
  // and deck then draws every layer AFTER MapLibre's frame (top of stack,
  // over labels) with no error. isStyleLoaded() is false while any source is
  // (re)loading — including right after a setLayoutProperty. So: wait for a
  // loaded style, add the overlay, THEN hide the static layers.
  // `waitForStyle: false` reproduces the silent failure for the record.
  if ((opts.waitForStyle ?? true) && !map.isStyleLoaded()) {
    await new Promise<void>((resolve) => {
      const check = () => {
        if (map.isStyleLoaded()) {
          map.off("idle", check);
          resolve();
        }
      };
      map.on("idle", check);
      map.triggerRepaint();
    });
  }
  const order = map.getLayersOrder();
  const state = new Map<
    string,
    { params: HatchParams; beforeId: string | undefined; data: GeoJSONFeature[]; phase: number; heavy: number }
  >();

  for (const layer of doc.layers) {
    const decl = layer["x-effect"];
    if (!decl) continue;
    if (decl.type !== "hatch-fill") {
      console.warn(`[spike] unknown effect type ${decl.type}; static layer stays`);
      continue;
    }
    const idx = order.indexOf(layer.id);
    const beforeId = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : undefined;
    const data = doc.sources[layer.source]!.data.features.filter((f) => matches(layer.filter, f));
    state.set(layer.id, { params: toHatchParams(decl), beforeId, data, phase: 0, heavy: 0 });
  }

  const build = () =>
    [...state.entries()].map(
      ([layerId, s]) =>
        new HatchLayer<GeoJSONFeature>({
          id: `${layerId}__fx`,
          data: s.data,
          // Only honored in interleaved mode; overlaid draws on its own canvas.
          beforeId: s.beforeId,
          getPolygon: (f: GeoJSONFeature) => f.geometry.coordinates as never,
          getFillColor: [0, 0, 0, 255],
          hatch: s.params,
          phase: s.phase,
          heavy: s.heavy,
        } as never)
    );

  const overlay = new MapLibreOverlay({ interleaved, layers: build() });
  map.addControl(overlay as never);
  for (const layerId of state.keys()) map.setLayoutProperty(layerId, "visibility", "none");

  // Loud placement check: in interleaved mode every effect must sit in a
  // deck layer group directly below its beforeId. Anything else means deck
  // fell back to drawing on top — a silent contract break we refuse.
  const after = map.getLayersOrder();
  const placementOk =
    !interleaved ||
    [...state.values()].every((s) => {
      const gid = s.beforeId
        ? `deck-maplibre-layer-group-before:${s.beforeId}`
        : "deck-maplibre-layer-group-last";
      const gi = after.indexOf(gid);
      return gi >= 0 && (s.beforeId === undefined || after[gi + 1] === s.beforeId);
    });
  if (!placementOk) {
    console.warn(
      "[spike] interleaved placement FAILED: deck layer groups missing from the style; " +
        "effects are drawing above every MapLibre layer (labels included)."
    );
  }

  return {
    overlay,
    placementOk,
    slots: [...state.entries()].map(([layerId, s]) => ({ layerId, beforeId: s.beforeId })),
    setParams(layerId, patch, extra) {
      const s = state.get(layerId);
      if (!s) throw new Error(`[spike] no effect on ${layerId}`);
      s.params = { ...s.params, ...patch };
      if (extra?.phase !== undefined) s.phase = extra.phase;
      if (extra?.heavy !== undefined) s.heavy = extra.heavy;
      overlay.setProps({ layers: build() });
    },
    destroy() {
      // finalize() === map.removeControl(overlay) → onRemove → layer groups
      // removed + deck instance finalized.
      overlay.finalize();
      for (const layerId of state.keys()) {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", "visible");
      }
    },
  };
}
