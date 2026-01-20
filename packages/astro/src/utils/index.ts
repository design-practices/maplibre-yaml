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
 * ## Collection Item Integration
 *
 * - **getCollectionItemWithLocationSchema** - Schema for collection items with single location
 * - **getCollectionItemWithLocationsSchema** - Schema for collection items with multiple locations
 * - **getCollectionItemWithRegionSchema** - Schema for collection items with polygon regions
 * - **getCollectionItemWithRouteSchema** - Schema for collection items with routes/trails
 * - **getCollectionItemWithGeoSchema** - Flexible schema with all geographic types
 *
 * ## Map Builders
 *
 * - **buildPointMapConfig** - Create map config from single location
 * - **buildMultiPointMapConfig** - Create map config from multiple locations
 * - **buildPolygonMapConfig** - Create map config from polygon region
 * - **buildRouteMapConfig** - Create map config from route/line
 * - **calculateCenter** - Calculate center of coordinates
 * - **calculateBounds** - Calculate bounding box of coordinates
 *
 * @example
 * ```typescript
 * import { loadMapConfig, getMapSchema } from '@maplibre-yaml/astro/utils';
 * import { getCollectionItemWithLocationSchema, buildPointMapConfig } from '@maplibre-yaml/astro/utils';
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

// Collection item schema utilities
export {
  getCollectionItemWithLocationSchema,
  getCollectionItemWithLocationsSchema,
  getCollectionItemWithRegionSchema,
  getCollectionItemWithRouteSchema,
  getCollectionItemWithGeoSchema,
  LocationPointSchema,
  RegionPolygonSchema,
  RouteLineSchema,
} from "./collections-schemas";

export type {
  LocationPoint,
  RegionPolygon,
  RouteLine,
} from "./collections-schemas";

// Map builder utilities
export {
  buildPointMapConfig,
  buildMultiPointMapConfig,
  buildPolygonMapConfig,
  buildRouteMapConfig,
  calculateCenter,
  calculateBounds,
} from "./map-builders";

export type {
  PointMapOptions,
  MultiPointMapOptions,
  PolygonMapOptions,
  RouteMapOptions,
} from "./map-builders";
