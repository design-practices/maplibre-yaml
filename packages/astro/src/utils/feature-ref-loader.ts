/**
 * @file GeoJSON file loader with feature-lookup helpers
 * @module @maplibre-yaml/astro/utils/feature-ref-loader
 *
 * @description
 * Provides the `GeoJSONLoadError` class and the pure `findFeature` lookup
 * helper. The async file loader (`loadFeatureFile`) and the cache
 * machinery are added in Unit 3.
 *
 * `findFeature` is intentionally pure: it operates on already-parsed
 * in-memory FeatureCollections and never touches disk. This keeps it
 * testable with synthetic inputs.
 */

import type { Feature, FeatureCollection } from "geojson";
import type { FeatureRef } from "./feature-ref-schema";

/**
 * Error thrown when GeoJSON file loading, validation, or feature lookup fails.
 *
 * @remarks
 * Modeled on `YAMLLoadError`. Failure modes covered:
 * - File not found
 * - File contains invalid JSON
 * - File is not a GeoJSON FeatureCollection
 * - No feature matches the lookup criteria
 * - Multiple features match the lookup criteria (V1 requires exactly one)
 * - Feature has an unsupported geometry type
 *
 * Forward-compatibility constraint #4: the constructor accepts an optional
 * ES2022 `cause` field via the `options` parameter. This keeps the future
 * shared-base-class introduction (`MaplibreYamlLoadError`) purely additive.
 *
 * @example Catch and inspect
 * ```typescript
 * try {
 *   const config = await buildFeatureMapConfig({ ref });
 * } catch (error) {
 *   if (error instanceof GeoJSONLoadError) {
 *     console.error('GeoJSON error:', error.message);
 *     console.error('File:', error.filePath);
 *     if (error.cause) console.error('Caused by:', error.cause);
 *   }
 * }
 * ```
 */
export class GeoJSONLoadError extends Error {
  /** Path to the GeoJSON file that failed (absolute when possible) */
  public filePath: string;

  /** Optional structured details about validation failures */
  public errors: { path: string; message: string }[];

  constructor(
    message: string,
    filePath: string,
    errors: { path: string; message: string }[] = [],
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "GeoJSONLoadError";
    this.filePath = filePath;
    this.errors = errors;
    if (options?.cause !== undefined) {
      // ES2022 Error.cause; setting via property assignment to be compatible
      // with both modern Node and any consumer that polyfills Error.
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * Find a single feature in a FeatureCollection matching a FeatureRef.
 *
 * @param fc - Already-parsed GeoJSON FeatureCollection
 * @param ref - Feature reference (must contain `featureId` OR `match`)
 * @param sourceLabel - Path or label describing the source, included in errors
 * @returns The single matching feature
 * @throws {GeoJSONLoadError} when zero features match or more than one matches
 *
 * @remarks
 * Pure function -- no filesystem, no caching, no async. Operates entirely
 * on in-memory data.
 *
 * Match semantics:
 * - `featureId`: exact equality against `feature.id` (top-level GeoJSON id).
 *   No type coercion: `42` does not match `"42"`.
 * - `match: { property, equals }`: exact equality against
 *   `feature.properties[property]`. Features with `properties: null` or
 *   missing properties are skipped without error.
 *
 * V1 requires exactly one match. Multi-match is a deferred V2 feature; for
 * now it produces an actionable error suggesting narrower criteria.
 *
 * @example Match by id
 * ```typescript
 * const feature = findFeature(fc, { source: "x.geojson", featureId: "poa-1.1" });
 * ```
 *
 * @example Match by property
 * ```typescript
 * const feature = findFeature(fc, {
 *   source: "x.geojson",
 *   match: { property: "gotf_id", equals: 1.1 },
 * });
 * ```
 */
export function findFeature(
  fc: FeatureCollection,
  ref: FeatureRef,
  sourceLabel: string = ref.source,
): Feature {
  if (!fc || fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    throw new GeoJSONLoadError(
      `Expected a GeoJSON FeatureCollection in ${sourceLabel}, got ${typeof fc === "object" && fc !== null ? (fc as { type?: unknown }).type ?? "unknown" : typeof fc}`,
      sourceLabel,
    );
  }

  const matches = ref.featureId !== undefined
    ? matchById(fc, ref.featureId)
    : ref.match !== undefined
      ? matchByProperty(fc, ref.match.property, ref.match.equals)
      : [];

  if (matches.length === 0) {
    throw notFoundError(fc, ref, sourceLabel);
  }

  if (matches.length > 1) {
    throw multiMatchError(matches, ref, sourceLabel);
  }

  return matches[0]!;
}

function matchById(
  fc: FeatureCollection,
  featureId: string | number,
): Feature[] {
  return fc.features.filter((f) => f.id === featureId);
}

function matchByProperty(
  fc: FeatureCollection,
  property: string,
  equals: string | number | boolean,
): Feature[] {
  return fc.features.filter((f) => {
    if (f.properties === null || f.properties === undefined) return false;
    return (f.properties as Record<string, unknown>)[property] === equals;
  });
}

function notFoundError(
  fc: FeatureCollection,
  ref: FeatureRef,
  sourceLabel: string,
): GeoJSONLoadError {
  const total = fc.features.length;

  if (ref.featureId !== undefined) {
    const sampleIds = fc.features
      .slice(0, 3)
      .map((f) => (f.id !== undefined ? JSON.stringify(f.id) : "(no id)"))
      .join(", ");
    return new GeoJSONLoadError(
      `No feature with id ${JSON.stringify(ref.featureId)} found in ${sourceLabel}. ` +
        `File contains ${total} feature${total === 1 ? "" : "s"}. ` +
        `Sample ids: ${sampleIds || "(none with ids)"}.`,
      sourceLabel,
    );
  }

  // match-by-property
  const property = ref.match!.property;
  const equals = ref.match!.equals;
  const sampleValues = fc.features
    .slice(0, 3)
    .map((f) => {
      const props = f.properties as Record<string, unknown> | null | undefined;
      const val = props?.[property];
      return val === undefined ? "(missing)" : JSON.stringify(val);
    })
    .join(", ");
  return new GeoJSONLoadError(
    `No feature where ${property} === ${JSON.stringify(equals)} in ${sourceLabel}. ` +
      `${total} feature${total === 1 ? "" : "s"} checked. ` +
      `Sample values for "${property}": ${sampleValues}.`,
    sourceLabel,
  );
}

function multiMatchError(
  matches: Feature[],
  ref: FeatureRef,
  sourceLabel: string,
): GeoJSONLoadError {
  const sample = matches
    .slice(0, 3)
    .map((f) => {
      if (ref.featureId !== undefined) {
        return f.id !== undefined ? JSON.stringify(f.id) : "(no id)";
      }
      const property = ref.match!.property;
      const props = f.properties as Record<string, unknown> | null | undefined;
      const val = props?.[property];
      return val === undefined ? "(missing)" : JSON.stringify(val);
    })
    .join(", ");

  const criterion = ref.featureId !== undefined
    ? `featureId ${JSON.stringify(ref.featureId)}`
    : `${ref.match!.property} === ${JSON.stringify(ref.match!.equals)}`;

  return new GeoJSONLoadError(
    `Match for ${criterion} returned ${matches.length} features in ${sourceLabel}. ` +
      `V1 requires exactly one match. Sample matches: ${sample}. ` +
      `Use a more specific match criterion (e.g., a unique property).`,
    sourceLabel,
  );
}
