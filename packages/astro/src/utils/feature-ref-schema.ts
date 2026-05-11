/**
 * @file Schema for referencing features in external GeoJSON files
 * @module @maplibre-yaml/astro/utils/feature-ref-schema
 *
 * @description
 * Defines `FeatureRefSchema`, a Zod schema that lets a collection item
 * reference a single feature in an external GeoJSON file (matched by
 * `featureId` or by `match: { property, equals }`) instead of inlining
 * the geometry coordinates in frontmatter.
 *
 * At build time, `buildFeatureMapConfig` reads the file, finds the
 * matching feature, detects its geometry type, and dispatches to the
 * existing point/polygon/route builders.
 *
 * ## Usage
 *
 * @example Match by feature.id
 * ```yaml
 * feature_ref:
 *   source: "./src/data/gowanus.geojson"
 *   featureId: "poa-1.1"
 * ```
 *
 * @example Match by property equality (more common in real-world GeoJSON)
 * ```yaml
 * feature_ref:
 *   source: "./src/data/gowanus.geojson"
 *   match:
 *     property: "gotf_id"
 *     equals: 1.1
 * ```
 *
 * @example Optional metadata overrides (fall back to feature.properties)
 * ```yaml
 * feature_ref:
 *   source: "./src/data/gowanus.geojson"
 *   featureId: "library-487"
 *   name: "New Library Branch"
 *   description: "Public library construction"
 *   zoom: 16
 *   markerColor: "#e74c3c"
 * ```
 */

import { z } from "zod";
import {
  LineStyleFields,
  LocationPointSchema,
  PointStyleFields,
  PolygonStyleFields,
  RegionPolygonSchema,
  RouteLineSchema,
} from "./collections-schemas";

/**
 * Match form: by property equality.
 *
 * @remarks
 * Forward-compatibility constraint: this object schema MUST NOT use
 * `.strict()`. V2 may add compound match keys like `all`, `any`, `in`,
 * `filter`. Default Zod behavior strips unknown keys but does not throw.
 *
 * @internal
 */
const MatchByPropertySchema = z
  .object({
    property: z
      .string()
      .describe("Property name to match (e.g., 'gotf_id')"),
    equals: z
      .union([z.string(), z.number(), z.boolean()])
      .describe("Value to match for exact equality"),
  })
  .describe("Match feature by single-property equality");

/**
 * Schema for referencing a feature in an external GeoJSON file.
 *
 * @remarks
 * Either `featureId` or `match` must be provided (but not both). The schema
 * also accepts optional display and style overrides that take precedence
 * over `feature.properties` at render time.
 *
 * **Display overrides** (fall back to `feature.properties.{name|description}`):
 * - `name` -- popup title
 * - `description` -- popup body
 * - `zoom` -- override map zoom level
 *
 * **Style overrides** (passed through to the underlying builder):
 * - `markerColor` -- for Point/MultiPoint features
 * - `fillColor`, `strokeColor`, `fillOpacity` -- for Polygon/MultiPolygon
 * - `color`, `width` -- for LineString
 *
 * @see buildFeatureMapConfig
 */
export const FeatureRefSchema = z
  .object({
    source: z
      .string()
      .describe(
        "Path to GeoJSON file (project-root-relative or absolute)",
      ),
    featureId: z
      .union([z.string(), z.number()])
      .optional()
      .describe("GeoJSON feature.id to match (top-level id field)"),
    match: MatchByPropertySchema.optional(),
    name: z
      .string()
      .optional()
      .describe("Override popup name (falls back to feature.properties.name)"),
    description: z
      .string()
      .optional()
      .describe(
        "Override popup description (falls back to feature.properties.description)",
      ),
    zoom: z
      .number()
      .min(0)
      .max(24)
      .optional()
      .describe("Override map zoom level"),
    // Style overrides reused from the per-geometry schemas in
    // `collections-schemas.ts`. Single source of truth: add a new style
    // field there and it lights up here automatically.
    ...PointStyleFields,
    ...PolygonStyleFields,
    ...LineStyleFields,
  })
  .describe("Reference to a feature in an external GeoJSON file");

// NOTE: FeatureRefSchema is intentionally a plain ZodObject (no `.superRefine`).
// Astro 5's content collection layer is known to be picky about ZodEffects
// schemas wrapped in `.optional()`, occasionally surfacing errors like
// "Content config not loaded" or "Cannot read properties of undefined".
// The XOR validation (must have featureId OR match, not both) is enforced
// at build time inside `buildFeatureMapConfig` and via the helper function
// `assertValidFeatureRef` exported below.

/** Inferred type for FeatureRef. */
export type FeatureRef = z.infer<typeof FeatureRefSchema>;

/**
 * Error thrown when a FeatureRef fails the XOR constraint
 * (must have `featureId` or `match`, not both, not neither).
 *
 * @remarks
 * Discriminable via `instanceof InvalidFeatureRefError` so consumers
 * who call `assertValidFeatureRef` directly can distinguish validation
 * failures from other errors.
 */
export class InvalidFeatureRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFeatureRefError";
  }
}

/**
 * Validates the XOR constraint on a FeatureRef: must have `featureId` OR
 * `match` (not both, not neither).
 *
 * @param ref - The FeatureRef to validate
 * @throws {InvalidFeatureRefError} when neither or both fields are set
 *
 * @remarks
 * Called automatically inside `buildFeatureMapConfig`. Exposed for
 * advanced consumers who want to validate refs at content-collection-parse
 * time alongside their own schema.
 *
 * @example In a content-collection schema with custom refinement
 * ```typescript
 * import { FeatureRefSchema, assertValidFeatureRef, InvalidFeatureRefError } from "@maplibre-yaml/astro";
 *
 * const customSchema = z.object({
 *   feature_ref: FeatureRefSchema.optional(),
 * }).superRefine((data, ctx) => {
 *   if (data.feature_ref) {
 *     try {
 *       assertValidFeatureRef(data.feature_ref);
 *     } catch (err) {
 *       if (err instanceof InvalidFeatureRefError) {
 *         ctx.addIssue({ code: "custom", message: err.message });
 *       } else throw err;
 *     }
 *   }
 * });
 * ```
 */
export function assertValidFeatureRef(ref: FeatureRef): void {
  const hasId = ref.featureId !== undefined;
  const hasMatch = ref.match !== undefined;

  if (!hasId && !hasMatch) {
    throw new InvalidFeatureRefError(
      "feature_ref must specify either 'featureId' or 'match: { property, equals }'",
    );
  }
  if (hasId && hasMatch) {
    throw new InvalidFeatureRefError(
      "feature_ref must specify exactly one of 'featureId' or 'match', not both",
    );
  }
}

/**
 * Creates a schema for collection items where geometry can come from inline
 * fields OR a `feature_ref`. Enforces mutual exclusivity: an item cannot
 * declare both `feature_ref` AND any of `location` / `region` / `route`.
 *
 * @param customFields - Additional fields to include in the schema
 * @returns Zod schema with cross-field validation
 *
 * @remarks
 * Use this factory when you want a single schema that covers both
 * inline-coordinate frontmatter (existing pattern) and ref-based frontmatter
 * (new in V1). The factory composes the four geometry fields plus a
 * `.superRefine()` that rejects coexistence at content-collection-parse time
 * with a clear error message.
 *
 * **Forward-compatibility note:** Future plural support (`feature_refs: [...]`)
 * would be added as a separate optional field; this factory's name does not
 * preclude that addition.
 *
 * @example Basic usage in src/content/config.ts
 * ```typescript
 * import { defineCollection } from 'astro:content';
 * import { glob } from 'astro/loaders';
 * import { getCollectionItemWithFeatureRefSchema } from '@maplibre-yaml/astro';
 *
 * export const collections = {
 *   poas: defineCollection({
 *     loader: glob({ pattern: "**\/*.md", base: "./src/content/poas" }),
 *     schema: getCollectionItemWithFeatureRefSchema({
 *       gotf_id: z.number(),
 *       status: z.string(),
 *     })
 *   })
 * };
 * ```
 *
 * @example Frontmatter that references a feature
 * ```yaml
 * ---
 * gotf_id: 1.1
 * status: "Complete"
 * feature_ref:
 *   source: "./src/data/gowanus.geojson"
 *   match:
 *     property: "gotf_id"
 *     equals: 1.1
 * ---
 * ```
 *
 * @example Frontmatter that uses inline coordinates (still works)
 * ```yaml
 * ---
 * gotf_id: 1.1
 * status: "Complete"
 * location:
 *   coordinates: [-73.985, 40.674]
 *   name: "Site"
 * ---
 * ```
 *
 * @example Mutual-exclusivity error: both forms specified
 * ```yaml
 * ---
 * # ERROR at build time:
 * # "Cannot use 'feature_ref' alongside inline geometry fields..."
 * feature_ref:
 *   source: "./data.geojson"
 *   featureId: "x"
 * location:
 *   coordinates: [0, 0]
 * ---
 * ```
 */
/**
 * Schema-level XOR enforcement. Intentionally stricter than the runtime
 * `buildMapConfigFromEntry` precedence chain: this schema rejects ambiguous
 * frontmatter at content-collection-parse time so authors see a clear error
 * in `astro dev`, while the entry builder accepts any field combination and
 * applies precedence for callers using the basic
 * `getCollectionItemSchema` or rolling their own collection shape.
 */
function applyMutualExclusivityRefinement<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((data: Record<string, unknown>, ctx) => {
    if (data.feature_ref === undefined) return;

    const conflicts: string[] = [];
    if (data.location !== undefined) conflicts.push("location");
    if (data.locations !== undefined) conflicts.push("locations");
    if (data.region !== undefined) conflicts.push("region");
    if (data.route !== undefined) conflicts.push("route");

    if (conflicts.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["feature_ref"],
        message:
          `Cannot use 'feature_ref' alongside inline geometry field(s): ` +
          `${conflicts.join(", ")}. ` +
          `Use either feature_ref OR inline geometry, not both.`,
      });
    }
  });
}

export function getCollectionItemWithFeatureRefSchema(
  customFields?: z.ZodRawShape,
) {
  const baseShape = {
    feature_ref: FeatureRefSchema.optional().describe(
      "Reference to a feature in an external GeoJSON file",
    ),
    location: LocationPointSchema.optional().describe(
      "Inline single location",
    ),
    locations: z
      .array(LocationPointSchema)
      .optional()
      .describe("Inline multiple locations"),
    region: RegionPolygonSchema.optional().describe(
      "Inline polygon region",
    ),
    route: RouteLineSchema.optional().describe("Inline route line"),
  };

  const inner = customFields
    ? z.object({ ...baseShape, ...customFields })
    : z.object(baseShape);

  return applyMutualExclusivityRefinement(inner);
}
