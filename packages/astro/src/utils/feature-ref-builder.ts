/**
 * @file Async builder for GeoJSON feature references
 * @module @maplibre-yaml/astro/utils/feature-ref-builder
 *
 * @description
 * Provides `buildFeatureMapConfig`, an async builder that loads a GeoJSON
 * file at build time, finds the matching feature, detects its geometry
 * type, and dispatches to the existing sync builders
 * (`buildPointMapConfig`, `buildPolygonMapConfig`, `buildRouteMapConfig`,
 * `buildMultiPointMapConfig`).
 *
 * **Common case (convenience):**
 * ```typescript
 * const config = await buildFeatureMapConfig({ ref }, globalConfig);
 * ```
 *
 * **Power case (shared file across many lookups):**
 * ```typescript
 * const fc = await loadFeatureFile(ref.source);
 * const feature = findFeature(fc, ref);
 * // ...dispatch manually using sync builders
 * ```
 *
 * Forward-compatibility constraints honored:
 * - #2: Runtime-environment guard is module-private and skippable via
 *   internal flag, leaving room for V2 runtime resolution.
 * - #7: Builder return type stays `Promise<MapBlock>`; new V2 behaviors
 *   should be new builders, not signature changes.
 */

import type {
  Feature,
  Position,
} from "geojson";
import type { GlobalConfig, MapBlock } from "@maplibre-yaml/core";
import {
  buildMultiLineStringMapConfig,
  buildMultiPointMapConfig,
  buildMultiPolygonMapConfig,
  buildPointMapConfig,
  buildPolygonMapConfig,
  buildRouteMapConfig,
} from "./map-builders";
import type { FeatureRef } from "./feature-ref-schema";
import { assertValidFeatureRef } from "./feature-ref-schema";
import {
  GeoJSONLoadError,
  findFeature,
  loadFeatureFile,
} from "./feature-ref-loader";

// Note: the previous V1 implementation maintained an `INTERNAL_ALLOW_RUNTIME`
// module-level flag with an exported `_setInternalAllowRuntime` setter
// intended to let V2 runtime variants opt out of the build-time guard.
// That pattern is unsafe under concurrent calls (the flag leaks across
// `await` boundaries) and the test that exercised it asserted nothing
// meaningful. Removed in V1.x.
//
// V2 runtime resolution should ship as a separate builder (e.g.,
// `buildFeatureMapConfigRuntime`) rather than reusing this one with a
// global mode switch. The forward-compat path remains additive:
// runtime-deployment failures are now surfaced via the `loadFeatureFile`
// ENOENT path, which detects serverless contexts (cwd=/var/task, etc.)
// and includes deployment-hint text in the error message.

/**
 * Options for `buildFeatureMapConfig`.
 */
export interface BuildFeatureMapOptions {
  /** Feature reference (validated by FeatureRefSchema) */
  ref: FeatureRef;
}

/**
 * Build a complete `MapBlock` from a feature reference.
 *
 * @param options - Object containing the feature ref
 * @param globalConfig - Optional global map config (defaultMapStyle, defaultCenter, defaultZoom)
 * @returns Promise that resolves to a fully-formed MapBlock
 * @throws {GeoJSONLoadError} when the file is missing, malformed, lacks the
 *   referenced feature, or contains an unsupported geometry type
 *
 * @remarks
 * Build-time only. Throws an actionable error if invoked outside a
 * build-time context (e.g., in a deployed SSR adapter where `process.cwd()`
 * does not contain the source file). V2 may add a runtime variant.
 *
 * Geometry dispatch: detects the feature's `geometry.type` and routes to
 * the appropriate sync builder. Supported V1 types: `Point`, `MultiPoint`,
 * `LineString`, `Polygon`, `MultiPolygon` (uses first ring set). Throws
 * for `MultiLineString` and `GeometryCollection`.
 *
 * Override precedence: `ref.name` and `ref.description` win over
 * `feature.properties.name` and `feature.properties.description`. Style
 * overrides on the ref (`markerColor`, `fillColor`, etc.) flow through
 * to the underlying sync builder.
 *
 * @example Basic usage
 * ```typescript
 * import { buildFeatureMapConfig } from '@maplibre-yaml/astro';
 *
 * const config = await buildFeatureMapConfig(
 *   {
 *     ref: {
 *       source: './src/data/gowanus.geojson',
 *       featureId: 'poa-1.1',
 *     },
 *   },
 *   globalMapConfig,
 * );
 * ```
 *
 * @example With property match
 * ```typescript
 * const config = await buildFeatureMapConfig(
 *   {
 *     ref: {
 *       source: './src/data/gowanus.geojson',
 *       match: { property: 'gotf_id', equals: 1.1 },
 *       name: 'New Library Branch',
 *       fillColor: '#3388ff',
 *     },
 *   },
 *   globalMapConfig,
 * );
 * ```
 */
export async function buildFeatureMapConfig(
  options: BuildFeatureMapOptions,
  globalConfig?: GlobalConfig,
): Promise<MapBlock> {
  const { ref } = options;

  // Enforce the featureId-XOR-match constraint at build time.
  // (FeatureRefSchema itself is a plain ZodObject for Astro 5 compatibility,
  // so this check runs here rather than inside the schema.)
  try {
    assertValidFeatureRef(ref);
  } catch (cause) {
    throw new GeoJSONLoadError(
      cause instanceof Error ? cause.message : String(cause),
      ref.source,
      [],
      { cause },
    );
  }

  const fc = await loadFeatureFile(ref.source);
  const feature = findFeature(fc, ref);
  return dispatchByGeometry(feature, ref, globalConfig);
}

/**
 * Project a GeoJSON Position to a 2D `[lng, lat]` tuple.
 *
 * GeoJSON Position is `[lng, lat]` OR `[lng, lat, altitude]` (RFC 7946 §3.1.1).
 * This helper:
 * 1. Drops Z/altitude explicitly (rather than via unsound `as` cast).
 * 2. Allocates a fresh tuple, breaking the reference to the cached source
 *    array. This means downstream mutation of the returned MapBlock cannot
 *    poison the file cache.
 *
 * @internal
 */
function to2D(p: Position): [number, number] {
  return [p[0]!, p[1]!];
}

/**
 * Maximum recursion depth for `GeometryCollection` unwrapping. Bounds
 * potential stack overflow on pathologically nested input.
 *
 * @internal
 */
const MAX_GEOMETRY_COLLECTION_DEPTH = 8;

/**
 * Dispatch a found feature to the appropriate sync builder based on its
 * geometry type. Applies frontmatter overrides over feature.properties.
 *
 * The `depth` parameter tracks GeometryCollection unwrapping recursion.
 *
 * @internal
 */
function dispatchByGeometry(
  feature: Feature,
  ref: FeatureRef,
  globalConfig?: GlobalConfig,
  depth = 0,
): MapBlock {
  const geom = feature.geometry;
  const props: Record<string, unknown> = feature.properties ?? {};
  const name =
    ref.name ?? (typeof props.name === "string" ? props.name : undefined);
  const description =
    ref.description ??
    (typeof props.description === "string" ? props.description : undefined);

  switch (geom.type) {
    case "Point":
      return buildPointMapConfig(
        {
          location: {
            coordinates: to2D(geom.coordinates),
            name,
            description,
            zoom: ref.zoom,
            markerColor: ref.markerColor,
          },
        },
        globalConfig,
      );

    case "MultiPoint":
      // Note (intentional divergence from entry-builder's `locations` branch):
      // GeoJSON MultiPoint has no per-point properties, so all markers share
      // the feature-level name/description/markerColor. For per-point control,
      // use inline `locations: LocationPoint[]` instead.
      return buildMultiPointMapConfig(
        {
          locations: geom.coordinates.map((coord) => ({
            coordinates: to2D(coord),
            name,
            description,
            markerColor: ref.markerColor,
          })),
        },
        globalConfig,
      );

    case "LineString":
      if (geom.coordinates.length < 2) {
        throw new GeoJSONLoadError(
          `LineString feature in ${ref.source} has fewer than 2 coordinates ` +
            `(got ${geom.coordinates.length}); cannot render a degenerate line.`,
          ref.source,
        );
      }
      return buildRouteMapConfig(
        {
          route: {
            coordinates: geom.coordinates.map(to2D),
            name,
            description,
            color: ref.color,
            width: ref.width,
          },
        },
        globalConfig,
      );

    case "Polygon":
      return buildPolygonMapConfig(
        {
          region: {
            coordinates: geom.coordinates.map((ring) => ring.map(to2D)),
            name,
            description,
            fillColor: ref.fillColor,
            strokeColor: ref.strokeColor,
            fillOpacity: ref.fillOpacity,
          },
        },
        globalConfig,
      );

    case "MultiPolygon":
      if (geom.coordinates.length === 0) {
        throw new GeoJSONLoadError(
          `MultiPolygon feature in ${ref.source} has no polygon coordinates`,
          ref.source,
        );
      }
      return buildMultiPolygonMapConfig(
        {
          region: {
            coordinates: geom.coordinates.map((polygon) =>
              polygon.map((ring) => ring.map(to2D)),
            ),
            name,
            description,
            fillColor: ref.fillColor,
            strokeColor: ref.strokeColor,
            fillOpacity: ref.fillOpacity,
          },
        },
        globalConfig,
      );

    case "MultiLineString": {
      if (geom.coordinates.length === 0) {
        throw new GeoJSONLoadError(
          `MultiLineString feature in ${ref.source} has no line coordinates`,
          ref.source,
        );
      }
      // Reject MultiLineStrings that contain any degenerate (<2 coord) segment,
      // matching the LineString single-geometry contract.
      const badSegment = geom.coordinates.findIndex((seg) => seg.length < 2);
      if (badSegment !== -1) {
        throw new GeoJSONLoadError(
          `MultiLineString feature in ${ref.source} has a segment at index ` +
            `${badSegment} with fewer than 2 coordinates; cannot render.`,
          ref.source,
        );
      }
      return buildMultiLineStringMapConfig(
        {
          route: {
            coordinates: geom.coordinates.map((line) => line.map(to2D)),
            name,
            description,
            color: ref.color,
            width: ref.width,
          },
        },
        globalConfig,
      );
    }

    case "GeometryCollection": {
      // Dispatch to the inner geometry when the collection has exactly one
      // member. Heterogeneous collections (multiple geometries) are not
      // supported in V1 -- split them into separate features.
      if (depth >= MAX_GEOMETRY_COLLECTION_DEPTH) {
        throw new GeoJSONLoadError(
          `GeometryCollection nesting in ${ref.source} exceeds maximum depth ` +
            `(${MAX_GEOMETRY_COLLECTION_DEPTH}). Flatten the geometry to a ` +
            `single Point/LineString/Polygon.`,
          ref.source,
        );
      }
      if (geom.geometries.length === 0) {
        throw new GeoJSONLoadError(
          `GeometryCollection feature in ${ref.source} is empty`,
          ref.source,
        );
      }
      if (geom.geometries.length > 1) {
        const types = geom.geometries.map((g) => g.type).join(", ");
        throw new GeoJSONLoadError(
          `GeometryCollection feature in ${ref.source} has ${geom.geometries.length} geometries (${types}). ` +
            `V1 supports single-geometry collections only. Split into separate features ` +
            `or simplify to a single Point/LineString/Polygon.`,
          ref.source,
        );
      }
      // Recurse with a synthetic Feature wrapping the inner geometry
      const innerFeature: Feature = {
        type: "Feature",
        geometry: geom.geometries[0]!,
        properties: feature.properties,
      };
      if (feature.id !== undefined) innerFeature.id = feature.id;
      return dispatchByGeometry(innerFeature, ref, globalConfig, depth + 1);
    }

    default: {
      // Exhaustiveness check: TypeScript's `geom` is now `never` here.
      // If a future GeoJSON type is added, this triggers a compile error,
      // forcing a deliberate handling decision.
      const _exhaustive: never = geom;
      void _exhaustive;
      throw new GeoJSONLoadError(
        `Unsupported geometry type "${(geom as { type: string }).type}" in feature ref ${ref.source}.`,
        ref.source,
      );
    }
  }
}
