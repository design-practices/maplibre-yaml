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
 * Interop rule (see renderer/maplibre-interop.ts for the full story): the
 * maplibre-gl CJS bundle has no `exports` map, so `export * from
 * "maplibre-gl"` loses every named export under Node ESM. Runtime values are
 * therefore re-exported explicitly off the interop-resolved namespace, and
 * the namespace itself ships as the default export for anything not named
 * here.
 */

import * as maplibre from "maplibre-gl";

const gl = ((maplibre as unknown as { default?: typeof maplibre }).default ??
  maplibre) as typeof maplibre;

/**
 * The resolved maplibre-gl namespace — every export, including ones this
 * module does not name individually.
 */
export default gl;

/** Register a custom URL-scheme handler (pmtiles, cog, stubbed test data). */
export const addProtocol: typeof maplibre.addProtocol = gl.addProtocol;
/** Remove a handler registered with {@link addProtocol}. */
export const removeProtocol: typeof maplibre.removeProtocol = gl.removeProtocol;

// The constructor surface, same names as maplibre-interop exports them, so
// `import { Map } from "@maplibre-yaml/core/maplibre"` works in value and
// type position alike.
export {
  Map,
  Popup,
  NavigationControl,
  GeolocateControl,
  ScaleControl,
  FullscreenControl,
  AttributionControl,
} from "./renderer/maplibre-interop";
