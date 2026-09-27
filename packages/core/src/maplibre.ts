/**
 * @file `@maplibre-yaml/core/maplibre` — the maplibre-gl module core runs on
 * @module @maplibre-yaml/core/maplibre
 *
 * @description
 * Consumers sometimes need the maplibre-gl *module*, not a map instance:
 * `addProtocol` (pmtiles, COG, tile transforms) registers on the module, so
 * a host that bundles its own copy of maplibre-gl registers protocols on a
 * module `<ml-map>` never consults. This subpath re-exports the exact module
 * core resolves — maplibre-gl stays external in every build, so the import
 * graph guarantees identity with the copy the renderer constructs maps from.
 *
 * Everything here is a re-export of `renderer/maplibre-interop.ts`, the one
 * sanctioned place maplibre-gl runtime values enter this package (its module
 * doc explains the Node-ESM named-export hazard that rule exists for). This
 * file adds no resolution logic of its own — do not import maplibre-gl
 * directly here.
 */

import { maplibregl } from "./renderer/maplibre-interop";

/**
 * The resolved maplibre-gl namespace — every export, including ones the
 * named surface below does not cover.
 */
export default maplibregl;

// addProtocol/removeProtocol, the constructor surface (Map, Popup, the
// controls), and the `maplibregl` namespace const — all interop-resolved.
export * from "./renderer/maplibre-interop";
