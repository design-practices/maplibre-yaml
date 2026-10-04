/**
 * @file Map-level 3D: terrain, sky, projection (U15)
 * @module @maplibre-yaml/core/renderer
 *
 * @description
 * The three style-spec root properties a document can now author. Each is
 * applied imperatively because the live style is built from the basemap plus
 * `addLayer` calls, never from the document's own style half.
 *
 * Every setter is **feature-detected**, following the U8 params-panel
 * precedent: the peer range spans maplibre-gl 3–5, and the setters arrived at
 * different times (`setTerrain` 2.2.0, `setSky` 4.5.0, `setProjection`
 * 5.0.0). A runtime that lacks one gets exactly one console warning naming the
 * minimum version and what the map does instead — the declared-absence
 * posture (R5) — never a silent no-op and never a thrown error, because a
 * missing 3D effect is a degraded map, not a broken one (ml-blj).
 */

import type {
  TerrainConfig,
  SkyConfig,
  ProjectionConfig,
} from "../schemas/map.schema";
// Runtime minimums (from the maplibre-gl changelog) live beside the state
// floor so emit's runtime gate and these live checks share one source.
import {
  TERRAIN_RUNTIME_FLOOR,
  SKY_RUNTIME_FLOOR,
  GLOBE_RUNTIME_FLOOR,
} from "../capabilities";

/** The slice of a maplibre-gl `Map` these helpers touch — all optional. */
export interface Scene3DMap {
  setTerrain?: (terrain: Record<string, unknown> | null) => unknown;
  setSky?: (sky: Record<string, unknown>) => unknown;
  setProjection?: (projection: Record<string, unknown>) => unknown;
  getSource?: (id: string) => { type?: string } | undefined;
}


const PREFIX = "[maplibre-yaml]";

/**
 * Apply `projection:`.
 *
 * @returns whether the runtime accepted it. `mercator` on a runtime without
 *   `setProjection` is trivially satisfied (it IS mercator) and does not warn.
 */
export function applyProjection(map: Scene3DMap, projection: ProjectionConfig): boolean {
  if (typeof map.setProjection === "function") {
    try {
      map.setProjection.call(map, { type: projection.type });
      return true;
    } catch (error) {
      console.warn(`${PREFIX} projection could not be applied:`, error);
      return false;
    }
  }
  if (projection.type === "mercator") return true;
  console.warn(
    `${PREFIX} this document declares \`projection: { type: ${projection.type} }\`, ` +
      "but the running maplibre-gl has no setProjection (needs >= " +
      `${GLOBE_RUNTIME_FLOOR}); the map renders in mercator.`
  );
  return false;
}

/** Apply `sky:`. Returns whether the runtime accepted it. */
export function applySky(map: Scene3DMap, sky: SkyConfig): boolean {
  if (typeof map.setSky !== "function") {
    console.warn(
      `${PREFIX} this document declares \`sky:\`, but the running maplibre-gl has ` +
        `no setSky (needs >= ${SKY_RUNTIME_FLOOR}); the map renders without sky or fog.`
    );
    return false;
  }
  try {
    map.setSky.call(map, { ...sky });
    return true;
  } catch (error) {
    console.warn(`${PREFIX} sky could not be applied:`, error);
    return false;
  }
}

/** Outcome of one terrain attempt. */
export type TerrainOutcome = "applied" | "pending" | "failed";

/**
 * Apply `terrain:`.
 *
 * @param final - `false` on the first attempt (right after named sources
 *   register); a source the document declares inline on a layer does not exist
 *   yet, so a miss returns `pending` silently. `true` on the retry after layers
 *   settle, where a miss is a real authoring error and warns.
 */
export function applyTerrain(
  map: Scene3DMap,
  terrain: TerrainConfig,
  final: boolean
): TerrainOutcome {
  if (typeof map.setTerrain !== "function") {
    console.warn(
      `${PREFIX} this document declares \`terrain:\`, but the running maplibre-gl has ` +
        `no setTerrain (needs >= ${TERRAIN_RUNTIME_FLOOR}); the map renders flat.`
    );
    return "failed";
  }
  const source = map.getSource?.call(map, terrain.source);
  if (!source) {
    if (!final) return "pending";
    console.warn(
      `${PREFIX} \`terrain.source\` names "${terrain.source}", which no source in the ` +
        "document or basemap declares; the map renders flat."
    );
    return "failed";
  }
  if (source.type !== undefined && source.type !== "raster-dem") {
    console.warn(
      `${PREFIX} \`terrain.source\` names "${terrain.source}", a ${source.type} source; ` +
        "terrain needs a raster-dem source, so the map renders flat."
    );
    return "failed";
  }
  try {
    map.setTerrain.call(map, {
      source: terrain.source,
      ...(terrain.exaggeration !== undefined ? { exaggeration: terrain.exaggeration } : {}),
    });
    return "applied";
  } catch (error) {
    console.warn(`${PREFIX} terrain could not be applied:`, error);
    return "failed";
  }
}
