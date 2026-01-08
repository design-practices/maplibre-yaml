/**
 * @file Main entry point for @maplibre-yaml/astro
 * @module @maplibre-yaml/astro
 *
 * @description
 * Astro components for declarative map creation with YAML.
 *
 * This package provides Astro-native components that wrap the @maplibre-yaml/core
 * library, making it easy to create interactive maps and scrollytelling experiences
 * in Astro applications.
 *
 * ## Components
 *
 * - **Map** - Basic map component for inline maps
 * - **FullPageMap** - Full viewport map with controls and legend
 * - **Scrollytelling** - Narrative scrollytelling with chapter-based transitions
 *
 * ## Utilities
 *
 * - **loadYAML** - Load and parse YAML files at build time
 * - **loadMapConfig** - Load and validate map configurations
 * - **loadScrollytellingConfig** - Load and validate scrollytelling configurations
 * - **getMapSchema** - Get Zod schema for content collections
 * - **getScrollytellingSchema** - Get Zod schema for content collections
 *
 * @example Basic Usage
 * ```astro
 * ---
 * import { Map } from '@maplibre-yaml/astro';
 * ---
 * <Map src="/configs/my-map.yaml" height="400px" />
 * ```
 *
 * @example With Build-Time Loading
 * ```astro
 * ---
 * import { Map, loadMapConfig } from '@maplibre-yaml/astro';
 * const config = await loadMapConfig('./src/configs/map.yaml');
 * ---
 * <Map config={config} height="400px" />
 * ```
 *
 * @example Scrollytelling
 * ```astro
 * ---
 * import { Scrollytelling } from '@maplibre-yaml/astro';
 * ---
 * <Scrollytelling src="/stories/earthquake.yaml" />
 * ```
 */

// Component exports (Astro components are exported directly)
export { default as Map } from "./components/Map.astro";
export { default as FullPageMap } from "./components/FullPageMap.astro";
export { default as Scrollytelling } from "./components/Scrollytelling.astro";

// Utility exports
export {
  loadYAML,
  loadMapConfig,
  loadScrollytellingConfig,
  loadFromGlob,
  YAMLLoadError,
} from "./utils/loader";

export {
  getMapSchema,
  getScrollytellingSchema,
  getChapterSchema,
  getSimpleMapSchema,
  extendSchema,
} from "./utils/collections";

// Type exports
export type {
  MapProps,
  FullPageMapProps,
  ScrollytellingProps,
  ChapterProps,
} from "./types";
