/**
 * @file RFC 7946 GeoJSON schema for maplibre-yaml
 * @module @maplibre-yaml/core/schemas/geojson
 *
 * @description
 * A real, DoS-safe Zod schema for RFC 7946 GeoJSON, authored to replace the
 * v0.5.0-deferred `source.data: z.any()` (R9/R11). It validates **structure**
 * only — coordinate nesting, geometry `type`, the Feature/FeatureCollection
 * envelopes — and deliberately does **not** check ring winding or
 * self-intersection: MapLibre tolerates loosely-conformant rings, so those are
 * out of scope.
 *
 * ## Where this applies (the dual posture)
 *
 * This schema is a HARD ERROR only where it is composed in — the v2 geojson
 * source's `data`/`prefetchedData` fields (`map-v2.schema.ts`). Format v1's
 * `source.data` stays `z.any()` (byte-for-byte compat, R2/R10). A schema can't
 * be "error under v2, warn under v1" because it doesn't know the document
 * version; the split is resolved by *scope*, not a version flag.
 *
 * ## DoS mitigations (R11)
 *
 * Inline `source.data` is untrusted input, the same resource-exhaustion class
 * as the merge-fan-out guard the parser already carries. Two mitigations:
 *
 * 1. **`discriminatedUnion`, not `union`.** The seven geometry types share a
 *    `type` discriminator, so a single node validates against exactly one
 *    branch (O(1)) rather than being tried against all seven (O(N)).
 * 2. **Depth-capped GeometryCollection.** `GeometryCollection` is self-recursive
 *    (`geometries: Geometry[]`). Rather than an unbounded `z.lazy`, the geometry
 *    schema is built eagerly to a fixed maximum nesting depth
 *    ({@link MAX_GEOMETRY_COLLECTION_DEPTH}). A chain nested beyond the cap hits
 *    a union whose deepest level has no `GeometryCollection` branch, so the
 *    discriminated union rejects on the discriminator immediately — it never
 *    walks the rest of the payload, so a hostile deep chain fails fast.
 *
 * ## TypeScript note
 *
 * The recursive geometry schema is more type-surface than the fields that hit
 * TS7056 (inferred-type-serialization overflow) before it, so the recursive and
 * top-level exports are annotated `z.ZodType`/`z.ZodTypeAny` explicitly — the
 * same technique {@link MapBlockSchema}/{@link MapBlockV2Schema} use.
 */

import { z } from "zod";

/**
 * Maximum GeometryCollection nesting depth accepted under v2.
 *
 * @remarks
 * RFC 7946 (§3.1.8) itself recommends avoiding nested GeometryCollections;
 * real data almost never nests them at all. Eight levels is far past any
 * legitimate use while still bounding the eager schema construction and the
 * per-payload validation cost. A chain deeper than this is rejected fast.
 */
export const MAX_GEOMETRY_COLLECTION_DEPTH = 8;

/**
 * A GeoJSON Position: `[longitude, latitude]` or `[longitude, latitude, altitude]`.
 *
 * @remarks
 * RFC 7946 §3.1.1 allows an optional third element (altitude/elevation), so a
 * 3-element position is VALID and is preserved as-is — never rejected or
 * stripped. Fewer than two elements is invalid.
 */
export const PositionSchema = z
  .array(z.number())
  .min(2)
  .max(3)
  .describe("[longitude, latitude] or [longitude, latitude, altitude]");

/**
 * A GeoJSON bounding box: RFC 7946 §5 permits 4 (2D) or 6 (3D) numbers.
 */
export const BBoxSchema = z
  .array(z.number())
  .min(4)
  .max(6)
  .describe("Bounding box: [west, south, east, north] (2D) or with min/max altitude (3D)");

// --- The seven geometry primitives, each with its own coordinate nesting. ---

/** `Point` — a single {@link PositionSchema}. */
export const PointSchema = z
  .object({
    type: z.literal("Point"),
    coordinates: PositionSchema,
    bbox: BBoxSchema.optional(),
  })
  .passthrough();

/** `MultiPoint` — an array of positions (`Position[]`). */
export const MultiPointSchema = z
  .object({
    type: z.literal("MultiPoint"),
    coordinates: z.array(PositionSchema),
    bbox: BBoxSchema.optional(),
  })
  .passthrough();

/** `LineString` — an array of positions (`Position[]`). */
export const LineStringSchema = z
  .object({
    type: z.literal("LineString"),
    coordinates: z.array(PositionSchema),
    bbox: BBoxSchema.optional(),
  })
  .passthrough();

/** `MultiLineString` — an array of lines (`Position[][]`). */
export const MultiLineStringSchema = z
  .object({
    type: z.literal("MultiLineString"),
    coordinates: z.array(z.array(PositionSchema)),
    bbox: BBoxSchema.optional(),
  })
  .passthrough();

/** `Polygon` — an array of linear rings (`Position[][]`). */
export const PolygonSchema = z
  .object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(PositionSchema)),
    bbox: BBoxSchema.optional(),
  })
  .passthrough();

/** `MultiPolygon` — an array of polygons (`Position[][][]`). */
export const MultiPolygonSchema = z
  .object({
    type: z.literal("MultiPolygon"),
    coordinates: z.array(z.array(z.array(PositionSchema))),
    bbox: BBoxSchema.optional(),
  })
  .passthrough();

/** The six non-collection geometry primitives (the depth-invariant members). */
const GEOMETRY_PRIMITIVES = [
  PointSchema,
  MultiPointSchema,
  LineStringSchema,
  MultiLineStringSchema,
  PolygonSchema,
  MultiPolygonSchema,
] as const;

/**
 * Build the discriminated-union members for geometry validation at a given
 * remaining depth.
 *
 * @remarks
 * At `depth <= 0` only the six primitives are returned — so a
 * `GeometryCollection` appearing at that level has no branch and is rejected on
 * its discriminator, fast, without the union descending into its `geometries`.
 * Above that, a depth-`(depth - 1)` `GeometryCollection` branch is added, whose
 * members recurse one level shallower. The whole tree is constructed eagerly
 * (no `z.lazy`), so the maximum work per node is bounded at schema-build time.
 */
function geometryMembers(
  depth: number
): [z.ZodTypeAny, ...z.ZodTypeAny[]] {
  if (depth <= 0) {
    return [...GEOMETRY_PRIMITIVES] as unknown as [
      z.ZodTypeAny,
      ...z.ZodTypeAny[]
    ];
  }
  const geometryCollection = z
    .object({
      type: z.literal("GeometryCollection"),
      geometries: z.array(
        z.discriminatedUnion(
          "type",
          geometryMembers(depth - 1) as unknown as [
            z.ZodDiscriminatedUnionOption<"type">,
            ...z.ZodDiscriminatedUnionOption<"type">[]
          ]
        )
      ),
      bbox: BBoxSchema.optional(),
    })
    .passthrough();
  return [...GEOMETRY_PRIMITIVES, geometryCollection] as unknown as [
    z.ZodTypeAny,
    ...z.ZodTypeAny[]
  ];
}

/**
 * Any GeoJSON geometry — the seven RFC 7946 geometry types, with
 * `GeometryCollection` nesting capped at {@link MAX_GEOMETRY_COLLECTION_DEPTH}.
 *
 * @remarks
 * Annotated `z.ZodTypeAny` to keep TypeScript from serializing the deeply-nested
 * inferred type (TS7056).
 */
export const GeometrySchema: z.ZodTypeAny = z.discriminatedUnion(
  "type",
  geometryMembers(MAX_GEOMETRY_COLLECTION_DEPTH) as unknown as [
    z.ZodDiscriminatedUnionOption<"type">,
    ...z.ZodDiscriminatedUnionOption<"type">[]
  ]
);

/**
 * A GeoJSON Feature: a geometry (or `null`), a properties object (or `null`),
 * and optional `id`/`bbox`.
 */
export const FeatureSchema = z
  .object({
    type: z.literal("Feature"),
    geometry: GeometrySchema.nullable(),
    properties: z.record(z.any()).nullable(),
    id: z.union([z.string(), z.number()]).optional(),
    bbox: BBoxSchema.optional(),
  })
  .passthrough();

/**
 * A GeoJSON FeatureCollection: an array of {@link FeatureSchema} and optional
 * `bbox`.
 */
export const FeatureCollectionSchema = z
  .object({
    type: z.literal("FeatureCollection"),
    features: z.array(FeatureSchema),
    bbox: BBoxSchema.optional(),
  })
  .passthrough();

/**
 * Top-level GeoJSON accepted as inline `source.data`: a `FeatureCollection`, a
 * bare `Feature`, or any bare geometry.
 *
 * @remarks
 * A single `discriminatedUnion("type", …)` across every top-level `type`
 * literal — one branch per node, the R11 mitigation. Inline source data is
 * usually a `FeatureCollection`, but a bare geometry or Feature is also legal
 * GeoJSON that MapLibre accepts. Annotated `z.ZodTypeAny` for the same TS7056
 * reason as {@link GeometrySchema}.
 */
export const GeoJSONSchema: z.ZodTypeAny = z.discriminatedUnion("type", [
  ...(geometryMembers(MAX_GEOMETRY_COLLECTION_DEPTH) as unknown as [
    z.ZodDiscriminatedUnionOption<"type">,
    ...z.ZodDiscriminatedUnionOption<"type">[]
  ]),
  FeatureSchema,
  FeatureCollectionSchema,
]);
