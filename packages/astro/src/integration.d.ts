/**
 * Types for `@maplibre-yaml/astro/integration` (implementation: integration.mjs).
 */
import type { AstroIntegration } from "astro";

/** Options for {@link maplibreYaml}. None yet; the object is reserved. */
export type MaplibreYamlOptions = Record<string, never>;

/**
 * The `@maplibre-yaml/astro` Astro integration. Optional: in `astro dev` it
 * reloads the page when a file read by `loadMapConfig`,
 * `loadScrollytellingConfig`, `loadGlobalMapConfig` or `feature_ref` changes
 * (re-running the modules that read it), and when YAML / GeoJSON / JSON under
 * `public/` changes.
 *
 * @example
 * ```js
 * // astro.config.mjs
 * import maplibreYaml from "@maplibre-yaml/astro/integration";
 * export default defineConfig({ integrations: [maplibreYaml()] });
 * ```
 */
export default function maplibreYaml(options?: MaplibreYamlOptions): AstroIntegration;

/** @internal The Vite plugin behind the integration. */
export function devReloadPlugin(
  publicDir: string,
  log?: (message: string) => void
): {
  name: string;
  apply: "serve";
  configureServer(server: unknown): void;
};
