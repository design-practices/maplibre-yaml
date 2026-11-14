/**
 * @file Grid sources on emit (ml-nb1.2, U5)
 * @module @maplibre-yaml/core/emitter/lower-grid
 *
 * @description
 * A `type: grid` source is a regular raster field maplibre-yaml decodes and
 * samples itself; MapLibre has no such source and refuses a style that
 * carries one. So the projection removes it from `style.sources` and keeps
 * its declaration under the style's root `metadata`, the slot the style spec
 * reserves for exactly this kind of carried-along data, keyed by source id
 * under {@link GRID_SOURCES_METADATA_KEY}. A maplibre-yaml renderer handed
 * the emitted style can recover the field from there.
 *
 * The drop is a `contract` warning, not a `lossy` one: no layer type draws a
 * grid in this release, so nothing the map shows changes, and `--strict`
 * passes. The one lossy case is a layer whose `source` is a grid. The parser
 * rejects that today (parser/grid-checks.ts), so the projection meets it only
 * in a model from older tooling or a hand-built one; it drops the layer and
 * says so, mirroring the effects precedent, so `--strict` refuses.
 *
 * Both the projection and the `source.grid` export-class registration draw
 * their wording from here, so the two cannot drift.
 */

import type { EmitWarning } from "./project";

type Obj = Record<string, unknown>;

/** The root `metadata` key the emitted style keeps grid declarations under, by source id. */
export const GRID_SOURCES_METADATA_KEY = "maplibre-yaml:grid-sources";

/** The registration's author-facing sentence (the docs table and the emit report). */
export const GRID_ON_EMIT =
  "A grid source is not a MapLibre source, so it is absent from the emitted style's " +
  `sources; its declaration is kept under metadata["${GRID_SOURCES_METADATA_KEY}"] ` +
  "for maplibre-yaml renderers to read. No layer type draws a grid, so nothing the " +
  "map shows is lost (a layer over a grid is dropped, lossy).";

/** Whether a source spec (named or inline) declares a grid. */
export function isGridSource(spec: unknown): spec is Obj & { type: "grid" } {
  return typeof spec === "object" && spec !== null && !Array.isArray(spec) && (spec as Obj)["type"] === "grid";
}

/** The result of lowering one grid source. */
export interface GridLowering {
  /** What the stash carries: the declaration's style half, as written. */
  declaration: Obj;
  warning: EmitWarning;
}

/**
 * Lower one grid source: its declaration for the metadata stash, and the
 * contract warning that says where it went.
 *
 * @param id - The source id (the stash key).
 * @param spec - The source's style half (`type`, `url`, `encoding`, geometry,
 *   `range`, `units`, `nodata`, `attribution`, `bands`). Runtime keys
 *   (`cache`, `loading`) are the caller's to report, as on every source.
 * @param path - Dotted path for the warning (`sources.<id>`).
 */
export function lowerGridSource(id: string, spec: Obj, path: string): GridLowering {
  return {
    declaration: { ...spec },
    warning: {
      path,
      kind: "contract",
      construct: "source.grid",
      exportClass: "no-export",
      message:
        `grid source \`${id}\` is not a MapLibre source; it is kept under metadata for ` +
        `maplibre-yaml renderers (metadata["${GRID_SOURCES_METADATA_KEY}"].${id}) and is ` +
        "absent from style.sources.",
    },
  };
}

/**
 * The lossy warning for a layer drawn over a grid, which the emitted style
 * cannot carry (the layer is dropped).
 *
 * @param layerId - The layer's id.
 * @param sourceId - The named grid source, or `undefined` for an inline one.
 */
export function layerOverGridWarning(layerId: string, sourceId: string | undefined): EmitWarning {
  const which = sourceId === undefined ? "an inline grid source" : `grid source \`${sourceId}\``;
  return {
    path: `layers.${layerId}.source`,
    kind: "lossy",
    construct: "source.grid",
    exportClass: "no-export",
    message:
      `layer \`${layerId}\` draws ${which}, which has no style.json form: the layer is ` +
      "absent from the emitted style. No layer type draws a grid; read its values from " +
      "page code with getGrid(id).sample(lngLat) instead.",
  };
}
