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
 * - **Real ESM builds** (maplibre-gl 6, which is ESM-only — `dist/*.mjs`
 *   behind an `exports` map with only an `import` condition — or esm.sh):
 *   named exports exist; `default` does not. v5's type declarations had
 *   already dropped the default export.
 *
 * - **Unbundled browser ESM serving the UMD file as-is** (Vite *dev* when
 *   maplibre-gl was never pre-bundled — e.g. it is imported only from a
 *   dependency's `.astro` component, which Vite's dep scanner does not
 *   crawl): the namespace is empty, but evaluating the UMD has already set
 *   `globalThis.maplibregl`. Without this fallback every
 *   `@maplibre-yaml/astro` component failed under `astro dev` with
 *   "Map is not a constructor" while `astro build` worked.
 *
 * Importing the namespace and preferring `default` when present yields
 * working constructors in every environment, while the exported types stay
 * the named ones that v5 declares. Do not import maplibre-gl runtime values
 * directly anywhere else in src/ — route them through this module.
 * (Type-only imports from "maplibre-gl" are fine; they're erased.)
 */

import * as maplibre from "maplibre-gl";

const umdGlobal = (globalThis as unknown as { maplibregl?: typeof maplibre })
  .maplibregl;

// `default` is read reflectively, not as `maplibre.default`: maplibre-gl 6 is
// ESM-only with no default export, and a static member access on the
// namespace makes Rollup/Vite warn `"default" is not exported by
// maplibre-gl.mjs` in every v6 consumer's build. Same value, no warning.
const defaultExport = Reflect.get(maplibre, "default") as unknown as typeof maplibre | undefined;

const gl = (defaultExport ??
  (typeof maplibre.Map === "function" ? maplibre : umdGlobal) ??
  maplibre) as typeof maplibre;

/**
 * The whole interop-resolved namespace, for module-level APIs not named
 * below (addProtocol and friends live here too, but consumers reaching for
 * anything else — setRTLTextPlugin, config — go through this).
 */
export const maplibregl = gl;

/** Register a custom URL-scheme handler (pmtiles, cog, stubbed test data). */
export const addProtocol: typeof maplibre.addProtocol = gl.addProtocol;
/** Remove a handler registered with {@link addProtocol}. */
export const removeProtocol: typeof maplibre.removeProtocol = gl.removeProtocol;

/**
 * The running maplibre-gl version, or undefined when the module does not
 * report one. Used to declare absence for version-gated layer types
 * (`color-relief`, U14) instead of letting MapLibre reject the document.
 */
export function runtimeVersion(): string | undefined {
  const getVersion = (gl as unknown as { getVersion?: () => string }).getVersion;
  if (typeof getVersion === "function") return getVersion();
  return undefined;
}

/**
 * maplibre-gl 6 locates its worker (`maplibre-gl-worker.mjs`) next to its own
 * module URL. Served as-is (an import map, a CDN) that just works; inside a
 * bundle the module URL is the bundle chunk's, the worker is not there, and
 * MapLibre reports "Worker failed to load". MapLibre makes the bundler user
 * call `setWorkerUrl()`; this appends that fix to the error a map surfaces,
 * so `ml-map:error` says what to do instead of only what broke. Other
 * messages, and every pre-6 runtime, pass through unchanged.
 */
export function withWorkerUrlHint(message: string, version: string | undefined): string {
  if (!/worker failed to load/i.test(message)) return message;
  const major = Number(version?.split(".")[0]);
  if (!(major >= 6)) return message;
  return (
    `${message} maplibre-gl ${version} is ESM-only and finds its worker next to its own module; ` +
    "under a bundler, call setWorkerUrl() from maplibre-gl with your bundler's URL for " +
    '"maplibre-gl/dist/maplibre-gl-worker.mjs" before the first map renders ' +
    '(Vite: import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url").'
  );
}

/**
 * Point maplibre-gl 6+ at its worker module — the bundler setup MapLibre
 * requires (see {@link withWorkerUrlHint}) — without forking on version.
 *
 * Applies only when the running maplibre-gl is 6 or later, `url` is given,
 * and nobody set a worker URL yet (a host's own `setWorkerUrl` call wins).
 * Before v6 it is a no-op: the v4/v5 bundle carries its worker inline, and
 * their `setWorkerUrl` expects a classic-script URL, not this module.
 *
 * @param url - the bundler's URL for `maplibre-gl/dist/maplibre-gl-worker.mjs`
 *   (Vite: `import url from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"`)
 * @returns whether the URL was applied
 */
export function setWorkerModuleUrl(url: string | undefined): boolean {
  if (!url) return false;
  const major = Number(runtimeVersion()?.split(".")[0]);
  if (!(major >= 6)) return false;
  const api = gl as unknown as { setWorkerUrl?: (u: string) => void; getWorkerUrl?: () => string };
  if (typeof api.setWorkerUrl !== "function") return false;
  if (typeof api.getWorkerUrl === "function" && api.getWorkerUrl()) return false;
  api.setWorkerUrl(url);
  return true;
}

export const Map: typeof maplibre.Map = gl.Map;
export const Popup: typeof maplibre.Popup = gl.Popup;
export const Marker: typeof maplibre.Marker = gl.Marker;
export const NavigationControl: typeof maplibre.NavigationControl =
  gl.NavigationControl;
export const GeolocateControl: typeof maplibre.GeolocateControl =
  gl.GeolocateControl;
export const ScaleControl: typeof maplibre.ScaleControl = gl.ScaleControl;
export const FullscreenControl: typeof maplibre.FullscreenControl =
  gl.FullscreenControl;
export const AttributionControl: typeof maplibre.AttributionControl =
  gl.AttributionControl;

/**
 * 3D toggle controls (U15). Possibly undefined: `GlobeControl` arrived in
 * maplibre-gl 5.0.0, so on a 4.x runtime the binding is absent and the
 * controls manager declares that absence instead of constructing `undefined`.
 */
// Typed structurally, not as `typeof maplibre.GlobeControl`: the CI matrix
// type-checks against the 4.x declarations too, which have no such export.
export const GlobeControl: (new () => maplibre.IControl) | undefined = (
  gl as unknown as { GlobeControl?: new () => maplibre.IControl }
).GlobeControl;
export const TerrainControl: typeof maplibre.TerrainControl | undefined = (
  gl as { TerrainControl?: typeof maplibre.TerrainControl }
).TerrainControl;

// Instance types under the same names, so `import { Map }` from this module
// works in both value and type position (mirroring maplibre-gl's own names).
export type Map = maplibre.Map;
export type Popup = maplibre.Popup;
export type Marker = maplibre.Marker;
export type NavigationControl = maplibre.NavigationControl;
export type GeolocateControl = maplibre.GeolocateControl;
export type ScaleControl = maplibre.ScaleControl;
export type FullscreenControl = maplibre.FullscreenControl;
export type AttributionControl = maplibre.AttributionControl;
