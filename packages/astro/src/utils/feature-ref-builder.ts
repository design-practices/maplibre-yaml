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
  GeoJsonProperties,
  GeometryCollection,
  LineString,
  MultiLineString,
  MultiPoint,
  MultiPolygon,
  Point,
  Polygon,
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

/**
 * Internal flag that lets V2 runtime resolution variants opt out of the
 * build-time-only guard without re-implementing the entire builder.
 *
 * Forward-compatibility constraint #2: keep this module-private and
 * @internal. Do NOT export from `index.ts`.
 *
 * @internal
 */
let INTERNAL_ALLOW_RUNTIME = false;

/**
 * Test-only opt-out for the runtime-environment guard. Lets tests verify
 * the guard fires without requiring an actual deployed SSR adapter
 * environment. Marked @internal; not exported from the package barrel.
 *
 * @internal
 */
export function _setInternalAllowRuntime(value: boolean): void {
  INTERNAL_ALLOW_RUNTIME = value;
}

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
  ensureBuildTimeContext(options.ref.source);

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
 * Throw an actionable error if `buildFeatureMapConfig` appears to be
 * running outside a build-time context. The signal we use is
 * `process.cwd()` -- in deployed SSR adapters (Vercel, Cloudflare,
 * Node serverless), cwd is the platform sandbox, not the project root,
 * so file paths won't resolve.
 *
 * Forward-compatibility constraint #2: the guard is skippable via
 * `INTERNAL_ALLOW_RUNTIME`. V2 runtime variants set this flag internally
 * before calling the loader, then unset it after.
 *
 * @internal
 */
function ensureBuildTimeContext(source: string): void {
  if (INTERNAL_ALLOW_RUNTIME) return;
  if (typeof process === "undefined" || typeof process.cwd !== "function") {
    throw new GeoJSONLoadError(
      `buildFeatureMapConfig is build-time only and cannot run in this environment. ` +
        `Resolve the feature ref at build time (e.g., via getStaticPaths or in your Astro frontmatter), ` +
        `then pass the resulting MapBlock to <Map config={...} />. ` +
        `Source: ${source}`,
      source,
    );
  }
}

/**
 * Dispatch a found feature to the appropriate sync builder based on its
 * geometry type. Applies frontmatter overrides over feature.properties.
 *
 * @internal
 */
function dispatchByGeometry(
  feature: Feature,
  ref: FeatureRef,
  globalConfig?: GlobalConfig,
): MapBlock {
  const geom = feature.geometry;
  const props = (feature.properties ?? {}) as GeoJsonProperties as Record<
    string,
    unknown
  >;
  const name = ref.name ?? (typeof props.name === "string" ? props.name : undefined);
  const description =
    ref.description ??
    (typeof props.description === "string" ? props.description : undefined);

  switch (geom.type) {
    case "Point": {
      const point = geom as Point;
      return buildPointMapConfig(
        {
          location: {
            coordinates: point.coordinates as [number, number],
            name,
            description,
            zoom: ref.zoom,
            markerColor: ref.markerColor,
          },
        },
        globalConfig,
      );
    }
    case "MultiPoint": {
      const mp = geom as MultiPoint;
      return buildMultiPointMapConfig(
        {
          locations: (mp.coordinates as Position[]).map(
            (coord) => ({
              coordinates: coord as [number, number],
              name,
              description,
              markerColor: ref.markerColor,
            }),
          ),
        },
        globalConfig,
      );
    }
    case "LineString": {
      const line = geom as LineString;
      return buildRouteMapConfig(
        {
          route: {
            coordinates: (line.coordinates as Position[]).map(
              (c) => c as [number, number],
            ),
            name,
            description,
            color: ref.color,
            width: ref.width,
          },
        },
        globalConfig,
      );
    }
    case "Polygon": {
      const polygon = geom as Polygon;
      return buildPolygonMapConfig(
        {
          region: {
            coordinates: (polygon.coordinates as Position[][]).map((ring) =>
              ring.map((c) => c as [number, number]),
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
    }
    case "MultiPolygon": {
      // Render ALL polygons via the dedicated multi-builder
      const mpoly = geom as MultiPolygon;
      if (mpoly.coordinates.length === 0) {
        throw new GeoJSONLoadError(
          `MultiPolygon feature in ${ref.source} has no polygon coordinates`,
          ref.source,
        );
      }
      return buildMultiPolygonMapConfig(
        {
          region: {
            coordinates: (mpoly.coordinates as Position[][][]).map((polygon) =>
              polygon.map((ring) => ring.map((c) => c as [number, number])),
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
    }
    case "MultiLineString": {
      // Render ALL lines via the dedicated multi-builder
      const mline = geom as MultiLineString;
      if (mline.coordinates.length === 0) {
        throw new GeoJSONLoadError(
          `MultiLineString feature in ${ref.source} has no line coordinates`,
          ref.source,
        );
      }
      return buildMultiLineStringMapConfig(
        {
          route: {
            coordinates: (mline.coordinates as Position[][]).map((line) =>
              line.map((c) => c as [number, number]),
            ),
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
      const gc = geom as GeometryCollection;
      if (gc.geometries.length === 0) {
        throw new GeoJSONLoadError(
          `GeometryCollection feature in ${ref.source} is empty`,
          ref.source,
        );
      }
      if (gc.geometries.length > 1) {
        const types = gc.geometries.map((g) => g.type).join(", ");
        throw new GeoJSONLoadError(
          `GeometryCollection feature in ${ref.source} has ${gc.geometries.length} geometries (${types}). ` +
            `V1 supports single-geometry collections only. Split into separate features ` +
            `or simplify to a single Point/LineString/Polygon.`,
          ref.source,
        );
      }
      // Recurse with a synthetic Feature wrapping the inner geometry
      const innerFeature: Feature = {
        type: "Feature",
        geometry: gc.geometries[0]!,
        properties: feature.properties,
      };
      if (feature.id !== undefined) innerFeature.id = feature.id;
      return dispatchByGeometry(innerFeature, ref, globalConfig);
    }
    default:
      throw new GeoJSONLoadError(
        `Unsupported geometry type "${geom.type}" in feature ref ${ref.source}. ` +
          `Supported: Point, MultiPoint, LineString, MultiLineString, Polygon, ` +
          `MultiPolygon, single-geometry GeometryCollection.`,
        ref.source,
      );
  }
}
