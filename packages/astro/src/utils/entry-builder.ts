/**
 * @file Convenience builder for content-collection entries
 * @module @maplibre-yaml/astro/utils/entry-builder
 *
 * @description
 * Provides `buildMapConfigFromEntry`, which absorbs the per-page geometry
 * dispatch chain that consumers would otherwise duplicate. The helper
 * inspects an entry's data, finds the first set geometry field by a fixed
 * precedence order, and dispatches to the matching builder.
 *
 * **Precedence order** (highest to lowest):
 * 1. `feature_ref` -- external GeoJSON file reference
 * 2. `region` -- inline polygon
 * 3. `route` -- inline line
 * 4. `locations` -- inline multi-point
 * 5. `location` -- inline single point
 * 6. `options.fallback` -- supplied default (or throws if absent)
 *
 * Field names follow the conventions established by the existing
 * `getCollectionItemWith*Schema` helpers and `FeatureRefSchema`. They are
 * library-specific naming choices (not GeoJSON canonicals); see the README's
 * "Two import paths" section for the rationale.
 */

import type { GlobalConfig, MapBlock } from "@maplibre-yaml/core";
import type {
  LocationPoint,
  RegionPolygon,
  RouteLine,
} from "./collections-schemas";
import type { FeatureRef } from "./feature-ref-schema";
import {
  buildMultiPointMapConfig,
  buildPointMapConfig,
  buildPolygonMapConfig,
  buildRouteMapConfig,
} from "./map-builders";
import { buildFeatureMapConfig } from "./feature-ref-builder";

/**
 * The shape `buildMapConfigFromEntry` recognizes on an entry's data.
 * Extra fields are ignored. All geometry fields are optional.
 */
export interface EntryGeometryFields {
  feature_ref?: FeatureRef;
  location?: LocationPoint;
  locations?: LocationPoint[];
  region?: RegionPolygon;
  route?: RouteLine;
}

/**
 * Optional behavior controls for `buildMapConfigFromEntry`.
 */
export interface BuildMapConfigFromEntryOptions {
  /**
   * Fallback location used when none of the geometry fields are set.
   * If omitted and no geometry is present, the helper throws.
   */
  fallback?: LocationPoint;
  /**
   * Default `name` applied to whichever geometry is selected, used when the
   * geometry's own `name` field is unset. Useful for content collections
   * where each entry has a page-level title that should appear in the popup.
   */
  label?: string;
  /**
   * Default `description` applied to whichever geometry is selected, used
   * when the geometry's own `description` field is unset.
   */
  description?: string;
}

/**
 * Build a `MapBlock` from a content-collection entry by detecting which
 * geometry field is set and dispatching to the appropriate builder.
 *
 * @param data - The entry data (e.g., `entry.data` from `getCollection`).
 *   Only the recognized geometry fields are read; extra fields are ignored.
 * @param globalConfig - Optional global map config (defaultMapStyle, defaultCenter, defaultZoom)
 * @param options - Optional fallback geometry and default name/description
 * @returns Promise that resolves to a fully-formed MapBlock
 * @throws {GeoJSONLoadError} when feature_ref is set and the file/feature
 *   can't be loaded (transparent passthrough from `buildFeatureMapConfig`)
 * @throws {Error} when no geometry field is set and no `fallback` is provided
 *
 * @remarks
 * **Precedence:** `feature_ref` > `region` > `route` > `locations` > `location` > `options.fallback`.
 * Only the first set field is honored; later fields are ignored if an earlier
 * one is present.
 *
 * **Relationship to `getCollectionItemWithFeatureRefSchema`:** the strict
 * schema rejects entries with `feature_ref` AND inline geometry at parse
 * time; this builder accepts them and applies precedence. Two policies for
 * two audiences: the schema is opinionated (early error in `astro dev`) for
 * authors who opt in, the builder is permissive for callers using the basic
 * `getCollectionItemSchema` or rolling their own. When the strict schema is
 * in use, only one geometry field will be set and precedence is moot.
 *
 * **Async always:** the helper is async because `feature_ref` requires file
 * I/O. When the entry uses inline geometry, the underlying call is sync but
 * the helper still returns a Promise for API consistency.
 *
 * **Field names are library conventions**, not GeoJSON properties. See the
 * README's "Two import paths" section for rationale. If your collection
 * uses different field names (e.g., `boundary` instead of `region`), call
 * the underlying builders (`buildPolygonMapConfig`, etc.) directly instead.
 *
 * @example Typical usage in a dynamic route
 * ```astro
 * ---
 * import { Map, buildMapConfigFromEntry } from '@maplibre-yaml/astro';
 * import { globalMapConfig } from '../../lib/map-config';
 *
 * const { entry } = Astro.props;
 * const mapConfig = await buildMapConfigFromEntry(entry.data, globalMapConfig, {
 *   label: entry.data.title,
 *   description: entry.data.summary,
 *   fallback: {
 *     coordinates: [-73.985, 40.674],
 *     name: entry.data.title,
 *   },
 * });
 * ---
 * <Map config={mapConfig} height="300px" />
 * ```
 */
export async function buildMapConfigFromEntry(
  data: EntryGeometryFields & Record<string, unknown>,
  globalConfig?: GlobalConfig,
  options?: BuildMapConfigFromEntryOptions,
): Promise<MapBlock> {
  const label = options?.label;
  const description = options?.description;

  // 1. Highest precedence: feature_ref (async path)
  if (data.feature_ref) {
    return buildFeatureMapConfig(
      {
        ref: {
          ...data.feature_ref,
          name: data.feature_ref.name ?? label,
          description: data.feature_ref.description ?? description,
        },
      },
      globalConfig,
    );
  }

  // 2. Polygon
  if (data.region) {
    return buildPolygonMapConfig(
      {
        region: {
          ...data.region,
          name: data.region.name ?? label,
          description: data.region.description ?? description,
        },
      },
      globalConfig,
    );
  }

  // 3. Line
  if (data.route) {
    return buildRouteMapConfig(
      {
        route: {
          ...data.route,
          name: data.route.name ?? label,
          description: data.route.description ?? description,
        },
      },
      globalConfig,
    );
  }

  // 4. Multi-point
  if (data.locations && data.locations.length > 0) {
    return buildMultiPointMapConfig(
      {
        locations: data.locations.map((loc) => ({
          ...loc,
          name: loc.name ?? label,
          description: loc.description ?? description,
        })),
      },
      globalConfig,
    );
  }

  // 5. Single point
  if (data.location) {
    return buildPointMapConfig(
      {
        location: {
          ...data.location,
          name: data.location.name ?? label,
          description: data.location.description ?? description,
        },
      },
      globalConfig,
    );
  }

  // 6. Fallback
  if (options?.fallback) {
    return buildPointMapConfig(
      {
        location: {
          ...options.fallback,
          name: options.fallback.name ?? label,
          description: options.fallback.description ?? description,
        },
      },
      globalConfig,
    );
  }

  throw new Error(
    "buildMapConfigFromEntry: entry has no geometry field set " +
      "(feature_ref, region, route, locations, location) and no `options.fallback` was provided. " +
      "Either populate one of the geometry fields, supply a fallback, or call the underlying " +
      "builders (buildPointMapConfig, etc.) directly with custom logic.",
  );
}
