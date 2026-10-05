/**
 * @file The ONE place the extrusions backend touches MapLibre internals
 * @module @maplibre-yaml/effects/backends/extrusions
 *
 * @description
 * The backend draws the static layer's own features from the tile bytes
 * MapLibre already loaded, so it never fetches a tile twice and its tile
 * selection is exactly MapLibre's. MapLibre has no public API for either,
 * so this module reads two internals:
 *
 * - `map.style.tileManagers[sourceId]` (`sourceCaches` before the 5.x
 *   rename) — `getVisibleCoordinates()` and `getTileByID(key)`;
 * - `tile.latestRawTileData` — the raw PBF MapLibre retains for queries.
 *
 * Plus the v5 custom-layer render argument `defaultProjectionData.mainMatrix`.
 *
 * maplibre-gl 6 (verified on 6.12): both internals are unchanged, but by
 * default (`zoomLevelsToOverscale: 4`) a vector tile past the source's
 * maxzoom is no longer the maxzoom tile overscaled — it is a SLICE, cut from
 * the maxzoom tile on the worker and re-encoded, with its own canonical
 * z/x/y. Those re-encoded bytes are not exact: the encoder truncates the
 * fractional deltas the clipper introduces, so vertices after a clip point
 * drift by a few tile units (≤ 4 measured at z17 over a z14 source; the
 * drift is in MapLibre's `latestRawTileData`, not in what it renders).
 * {@link TileView.reencoded} reports such tiles so geometry matching across
 * tiles (the seam fix) can widen its tolerance for them.
 *
 * Every access is feature-checked here and nowhere else. When a check
 * fails the backend declares absence — warns once, keeps the static layer
 * visible — instead of drawing something wrong. An upstream request for a
 * public hook is drafted in the U13′ PR (ml-vw4.2); when MapLibre ships one,
 * this file is the whole migration.
 */

import type { Map as MapLibreMap } from "maplibre-gl";

/** A visible tile as MapLibre identifies it. */
export interface TileCoord {
  key: string;
  wrap: number;
  overscaledZ: number;
  canonical: { z: number; x: number; y: number };
}

/** Read-only view of one source's loaded tiles. */
export interface TileView {
  /** Exactly the tiles MapLibre draws this frame. */
  coords(): TileCoord[];
  /** The tile's raw vector-tile bytes, or null while it is loading. */
  raw(coord: TileCoord): ArrayBuffer | null;
  /** True when MapLibre reports the tile loaded (bytes or not). */
  loaded(coord: TileCoord): boolean;
  /**
   * True when the tile's bytes are MapLibre's re-encoded slice of a deeper
   * zoom than the source serves (maplibre-gl 6 overzoom slicing), whose
   * vertices may drift a few units; false for bytes as the server sent them.
   */
  reencoded(coord: TileCoord): boolean;
}

export type Probe<T> = { ok: true; value: T } | { ok: false; reason: string };

type InternalTile = { latestRawTileData?: ArrayBuffer | null; state?: string };
type InternalManager = {
  getVisibleCoordinates(): TileCoord[];
  getTileByID(key: string): InternalTile | undefined;
};

function managers(map: MapLibreMap): Record<string, InternalManager> | undefined {
  const style = (map as unknown as { style?: Record<string, unknown> }).style;
  if (!style) return undefined;
  return (style["tileManagers"] ?? style["sourceCaches"]) as Record<string, InternalManager> | undefined;
}

/** Feature-check the tile internals for one source. */
export function probeTiles(map: MapLibreMap, sourceId: string): Probe<TileView> {
  const all = managers(map);
  if (!all || typeof all !== "object") {
    return {
      ok: false,
      reason:
        "this maplibre-gl does not expose its tile managers (style.tileManagers) — " +
        "the extrusions backend needs maplibre-gl 5",
    };
  }
  const tm = all[sourceId];
  if (!tm || typeof tm.getVisibleCoordinates !== "function" || typeof tm.getTileByID !== "function") {
    return {
      ok: false,
      reason: `source "${sourceId}" has no tile manager with getVisibleCoordinates/getTileByID`,
    };
  }
  // v5 overscales: past maxzoom the canonical z stays AT maxzoom, so this is
  // false there by construction; only v6 slicing yields canonical z > maxzoom.
  // Read per call: a TileJSON source learns its maxzoom when the JSON loads.
  const getSource = (map as unknown as { getSource?: (id: string) => { maxzoom?: unknown } | undefined })
    .getSource;
  const maxzoom = () => (typeof getSource === "function" ? getSource.call(map, sourceId)?.maxzoom : undefined);
  return {
    ok: true,
    value: {
      coords: () => tm.getVisibleCoordinates(),
      raw: (coord) => tm.getTileByID(coord.key)?.latestRawTileData ?? null,
      loaded: (coord) => tm.getTileByID(coord.key)?.state === "loaded",
      reencoded: (coord) => {
        const mz = maxzoom();
        return typeof mz === "number" && coord.canonical.z > mz;
      },
    },
  };
}

/** The v5 custom-layer projection matrix for mercator world coordinates. */
export function probeMainMatrix(renderArgs: unknown): ArrayLike<number> | null {
  const m = (renderArgs as { defaultProjectionData?: { mainMatrix?: ArrayLike<number> } } | null)
    ?.defaultProjectionData?.mainMatrix;
  return m && typeof m.length === "number" && m.length === 16 ? m : null;
}

/** True unless the map renders a non-mercator projection (globe). */
export function isMercator(map: MapLibreMap): boolean {
  const getProjection = (map as unknown as { getProjection?: () => { type?: unknown } | undefined }).getProjection;
  if (typeof getProjection !== "function") return true;
  const type = getProjection.call(map)?.type;
  return type === undefined || type === "mercator";
}

/** True when 3D terrain is on (the backend does not drape onto terrain). */
export function hasTerrain(map: MapLibreMap): boolean {
  const getTerrain = (map as unknown as { getTerrain?: () => unknown }).getTerrain;
  return typeof getTerrain === "function" && !!getTerrain.call(map);
}

/** Layer ids in render order (v5 API, with a getStyle() fallback). */
export function layerOrder(map: MapLibreMap): string[] {
  const m = map as unknown as { getLayersOrder?: () => string[] };
  if (typeof m.getLayersOrder === "function") return m.getLayersOrder();
  return (map.getStyle()?.layers ?? []).map((l) => l.id);
}
