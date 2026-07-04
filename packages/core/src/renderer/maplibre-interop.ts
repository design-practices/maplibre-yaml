/**
 * @file maplibre-gl named-export interop
 * @module @maplibre-yaml/core/renderer
 *
 * @description
 * Single place where maplibre-gl runtime values enter this package.
 *
 * maplibre-gl (v3–v5) ships a CJS bundle with no `exports` map, which makes
 * its bindings environment-dependent:
 *
 * - **Node ESM**: cjs-module-lexer cannot statically detect the bundle's
 *   named exports, so `import { Map } from "maplibre-gl"` throws at import
 *   time ("Named export not found") — only the `default` binding
 *   (`module.exports`) is populated. This is why a straight named-import
 *   conversion was reverted once before: it broke every Node consumer of
 *   this package (the CLI's `validate`, Astro's content loader).
 * - **Bundlers** (Vite/esbuild/webpack): CJS interop populates both named
 *   and default bindings.
 * - **Real ESM builds** (esm.sh via the documented CDN import map, or a
 *   future ESM-only maplibre-gl): named exports exist; `default` may not.
 *   maplibre-gl v5's type declarations already dropped the default export.
 *
 * Importing the namespace and preferring `default` when present yields
 * working constructors in every environment, while the exported types stay
 * the named ones that v5 declares. Do not import maplibre-gl runtime values
 * directly anywhere else in src/ — route them through this module.
 * (Type-only imports from "maplibre-gl" are fine; they're erased.)
 */

import * as maplibre from "maplibre-gl";

const gl = ((maplibre as unknown as { default?: typeof maplibre }).default ??
  maplibre) as typeof maplibre;

export const Map: typeof maplibre.Map = gl.Map;
export const Popup: typeof maplibre.Popup = gl.Popup;
export const NavigationControl: typeof maplibre.NavigationControl =
  gl.NavigationControl;
export const GeolocateControl: typeof maplibre.GeolocateControl =
  gl.GeolocateControl;
export const ScaleControl: typeof maplibre.ScaleControl = gl.ScaleControl;
export const FullscreenControl: typeof maplibre.FullscreenControl =
  gl.FullscreenControl;

// Instance types under the same names, so `import { Map }` from this module
// works in both value and type position (mirroring maplibre-gl's own names).
export type Map = maplibre.Map;
export type Popup = maplibre.Popup;
export type NavigationControl = maplibre.NavigationControl;
export type GeolocateControl = maplibre.GeolocateControl;
export type ScaleControl = maplibre.ScaleControl;
export type FullscreenControl = maplibre.FullscreenControl;
