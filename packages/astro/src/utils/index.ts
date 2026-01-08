/**
 * @file Utility exports for @maplibre-yaml/astro
 * @module @maplibre-yaml/astro/utils
 *
 * @description
 * Utility functions for loading YAML configurations and working with
 * Astro content collections.
 *
 * ## Loaders
 *
 * - **loadYAML** - Generic YAML loader with validation
 * - **loadMapConfig** - Load and validate map configurations
 * - **loadScrollytellingConfig** - Load and validate scrollytelling configurations
 * - **loadFromGlob** - Load multiple YAML files using glob patterns
 *
 * ## Content Collection Helpers
 *
 * - **getMapSchema** - Get Zod schema for map content collections
 * - **getScrollytellingSchema** - Get Zod schema for scrollytelling content collections
 * - **getChapterSchema** - Get Zod schema for chapter definitions
 * - **getSimpleMapSchema** - Get simplified schema for basic maps
 *
 * @example
 * ```typescript
 * import { loadMapConfig, getMapSchema } from '@maplibre-yaml/astro/utils';
 * ```
 */

// Loader utilities
export {
  loadYAML,
  loadMapConfig,
  loadScrollytellingConfig,
  loadFromGlob,
  YAMLLoadError,
} from "./loader";

// Content collection utilities
export {
  getMapSchema,
  getScrollytellingSchema,
  getChapterSchema,
  getSimpleMapSchema,
  extendSchema,
} from "./collections";
