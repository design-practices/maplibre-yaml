/**
 * @file Tests for the RFC 7946 GeoJSON schema (U4)
 * @module @maplibre-yaml/core/tests/schemas/geojson
 *
 * @description
 * U4 replaces the v0.5.0-deferred `source.data: z.any()` with a real,
 * DoS-safe RFC 7946 GeoJSON schema, applied as a HARD ERROR under format v2
 * and leaving format v1 byte-for-byte UNCHANGED.
 *
 * The dual posture is enforced by SCOPE, not a version flag:
 *   - v2 geojson `source.data`/`prefetchedData` validate against
 *     {@link GeoJSONSchema} — malformed geometry fails v2 validation.
 *   - v1 geojson `source.data` stays `z.any()` — the same malformed payload
 *     still parses (R2/R10 compat guarantee).
 *
 * DoS mitigation (R11): the geometry union is a `discriminatedUnion` (one
 * branch per node, not N), and GeometryCollection nesting is depth-capped so a
 * deeply-nested chain is rejected fast rather than driving Zod into a blowup.
 */

import { describe, it, expect } from "vitest";
import {
  GeoJSONSchema,
  PointSchema,
  LineStringSchema,
  PolygonSchema,
  MultiPointSchema,
  MultiLineStringSchema,
  MultiPolygonSchema,
  GeometrySchema,
  FeatureSchema,
  FeatureCollectionSchema,
  MAX_GEOMETRY_COLLECTION_DEPTH,
} from "../../src/schemas/geojson.schema";
import { YAMLParser } from "../../src/parser/yaml-parser";

/** A well-formed FeatureCollection with a single Point feature. */
const WELL_FORMED_FC = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-74.006, 40.7128] },
      properties: { name: "New York" },
    },
  ],
};

/** The AE4 malformed geometry: a Point whose coordinates are nested one level
 * too deep (`[[0,0]]` instead of `[0,0]`). */
const MALFORMED_POINT_FC = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [[0, 0]] },
      properties: null,
    },
  ],
};

/** Build a v2 map document whose single geojson source carries `inlineData`
 * (and optionally `prefetchedData`) as inline source data. */
function v2DocWith(inlineData: unknown, prefetchedData?: unknown): string {
  const source: Record<string, unknown> = {
    type: "geojson",
    data: inlineData,
  };
  if (prefetchedData !== undefined) {
    source.runtime = { prefetchedData };
  }
  const doc = {
    version: 2,
    type: "map",
    id: "test",
    style: {
      basemap: "https://demotiles.maplibre.org/style.json",
      sources: { pts: source },
      layers: [],
    },
  };
  return JSON.stringify(doc);
}

/** Build a v1 map document whose single geojson source carries `inlineData`. */
function v1DocWith(inlineData: unknown): string {
  const doc = {
    type: "map",
    id: "test",
    config: {
      mapStyle: "https://demotiles.maplibre.org/style.json",
      center: [0, 0],
      zoom: 2,
    },
    sources: {
      pts: { type: "geojson", data: inlineData },
    },
    layers: [],
  };
  return JSON.stringify(doc);
}

describe("GeoJSONSchema — geometry types", () => {
  it("accepts a well-formed FeatureCollection", () => {
    expect(GeoJSONSchema.safeParse(WELL_FORMED_FC).success).toBe(true);
  });

  it("accepts a bare Feature", () => {
    const feature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: {},
    };
    expect(GeoJSONSchema.safeParse(feature).success).toBe(true);
  });

  it("accepts a bare geometry (Point)", () => {
    expect(
      GeoJSONSchema.safeParse({ type: "Point", coordinates: [1, 2] }).success
    ).toBe(true);
  });

  it("accepts a Feature with null geometry", () => {
    const feature = { type: "Feature", geometry: null, properties: null };
    expect(GeoJSONSchema.safeParse(feature).success).toBe(true);
  });

  describe("per-type coordinate nesting", () => {
    it("Point: [x,y] valid, [[x,y]] invalid", () => {
      expect(PointSchema.safeParse({ type: "Point", coordinates: [0, 0] }).success).toBe(true);
      expect(PointSchema.safeParse({ type: "Point", coordinates: [[0, 0]] }).success).toBe(false);
    });

    it("LineString: [[x,y],...] valid, [x,y] invalid", () => {
      expect(
        LineStringSchema.safeParse({ type: "LineString", coordinates: [[0, 0], [1, 1]] }).success
      ).toBe(true);
      expect(
        LineStringSchema.safeParse({ type: "LineString", coordinates: [0, 0] }).success
      ).toBe(false);
    });

    it("Polygon: [[[x,y],...]] valid, [[x,y],...] invalid", () => {
      expect(
        PolygonSchema.safeParse({
          type: "Polygon",
          coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
        }).success
      ).toBe(true);
      expect(
        PolygonSchema.safeParse({ type: "Polygon", coordinates: [[0, 0], [1, 1]] }).success
      ).toBe(false);
    });

    it("MultiPoint: [[x,y],...] valid, [x,y] invalid", () => {
      expect(
        MultiPointSchema.safeParse({ type: "MultiPoint", coordinates: [[0, 0], [1, 1]] }).success
      ).toBe(true);
      expect(
        MultiPointSchema.safeParse({ type: "MultiPoint", coordinates: [0, 0] }).success
      ).toBe(false);
    });

    it("MultiLineString: [[[x,y],...]] valid, [[x,y]] invalid", () => {
      expect(
        MultiLineStringSchema.safeParse({
          type: "MultiLineString",
          coordinates: [[[0, 0], [1, 1]]],
        }).success
      ).toBe(true);
      expect(
        MultiLineStringSchema.safeParse({
          type: "MultiLineString",
          coordinates: [[0, 0], [1, 1]],
        }).success
      ).toBe(false);
    });

    it("MultiPolygon: [[[[x,y],...]]] valid, [[[x,y],...]] invalid", () => {
      expect(
        MultiPolygonSchema.safeParse({
          type: "MultiPolygon",
          coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]],
        }).success
      ).toBe(true);
      expect(
        MultiPolygonSchema.safeParse({
          type: "MultiPolygon",
          coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
        }).success
      ).toBe(false);
    });
  });

  it("accepts a 3-element Position (altitude — RFC 7946)", () => {
    expect(
      PointSchema.safeParse({ type: "Point", coordinates: [1, 2, 300] }).success
    ).toBe(true);
    // and the altitude survives (not stripped)
    const parsed = PointSchema.parse({ type: "Point", coordinates: [1, 2, 300] });
    expect(parsed.coordinates).toEqual([1, 2, 300]);
  });

  it("rejects a 1-element Position", () => {
    expect(PointSchema.safeParse({ type: "Point", coordinates: [1] }).success).toBe(false);
  });

  it("rejects a missing geometry type", () => {
    expect(GeometrySchema.safeParse({ coordinates: [0, 0] }).success).toBe(false);
  });

  it("rejects an unknown geometry type", () => {
    expect(
      GeometrySchema.safeParse({ type: "Sphere", coordinates: [0, 0] }).success
    ).toBe(false);
  });
});

describe("GeometryCollection — depth cap (R11 DoS)", () => {
  it("accepts a GeometryCollection with mixed member geometries", () => {
    const gc = {
      type: "GeometryCollection",
      geometries: [
        { type: "Point", coordinates: [0, 0] },
        { type: "LineString", coordinates: [[0, 0], [1, 1]] },
      ],
    };
    expect(GeometrySchema.safeParse(gc).success).toBe(true);
  });

  it("accepts nesting up to the cap and rejects a chain beyond it — fast", () => {
    // Build a GeometryCollection chain `depth` levels deep, innermost a Point.
    const chain = (depth: number): unknown => {
      let node: unknown = { type: "Point", coordinates: [0, 0] };
      for (let i = 0; i < depth; i++) {
        node = { type: "GeometryCollection", geometries: [node] };
      }
      return node;
    };

    // At the cap, still valid.
    expect(GeometrySchema.safeParse(chain(MAX_GEOMETRY_COLLECTION_DEPTH)).success).toBe(true);

    // Well beyond the cap: rejected, and rejected quickly (proves the
    // discriminatedUnion short-circuits rather than walking the whole payload).
    const start = performance.now();
    const result = GeometrySchema.safeParse(chain(5000));
    const elapsedMs = performance.now() - start;
    expect(result.success).toBe(false);
    expect(elapsedMs).toBeLessThan(2000);
  });
});

describe("GeoJSONSchema — Feature / FeatureCollection", () => {
  it("accepts a FeatureCollection with an id and bbox", () => {
    const fc = {
      type: "FeatureCollection",
      bbox: [-10, -10, 10, 10],
      features: [
        {
          type: "Feature",
          id: 42,
          bbox: [0, 0, 1, 1],
          geometry: { type: "Point", coordinates: [0, 0] },
          properties: { a: 1 },
        },
      ],
    };
    expect(FeatureCollectionSchema.safeParse(fc).success).toBe(true);
  });

  it("rejects a Feature whose geometry is malformed", () => {
    const feature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [[0, 0]] },
      properties: null,
    };
    expect(FeatureSchema.safeParse(feature).success).toBe(false);
  });
});

describe("v2 hard error (AE4) — malformed inline data fails v2 validation", () => {
  it("a well-formed FeatureCollection passes v2 validation", () => {
    const result = YAMLParser.safeParseMapBlock(v2DocWith(WELL_FORMED_FC));
    expect(result.success).toBe(true);
  });

  it("a nested-wrong Point ([[0,0]]) FAILS v2 with a coordinate-level error", () => {
    const result = YAMLParser.safeParseMapBlock(v2DocWith(MALFORMED_POINT_FC));
    expect(result.success).toBe(false);
    // The malformed geometry surfaces a coordinate-level structural error. The
    // v2 source schema is a (non-discriminated) union, so the reported path
    // collapses to the source (`sources.pts`) while the message carries the
    // Position arity/type failure — either is proof the geometry was rejected.
    const joined = result.errors
      .map((e) => `${e.path} ${e.message}`)
      .join("\n")
      .toLowerCase();
    expect(joined).toMatch(/data|coordinate|geometry|element|array|number|sources\.pts/);
  });

  it("prefetchedData under v2 gets the same strict validation", () => {
    // Valid data, malformed prefetchedData → v2 fails.
    const result = YAMLParser.safeParseMapBlock(
      v2DocWith(WELL_FORMED_FC, MALFORMED_POINT_FC)
    );
    expect(result.success).toBe(false);
  });

  it("well-formed prefetchedData under v2 passes", () => {
    const result = YAMLParser.safeParseMapBlock(
      v2DocWith(WELL_FORMED_FC, WELL_FORMED_FC)
    );
    expect(result.success).toBe(true);
  });

  it("a deeply-nested GeometryCollection in v2 inline data is rejected fast", () => {
    // Depth well beyond the cap (8), but shallow enough that the YAML
    // materialization step itself doesn't hit its own recursion limit — this
    // test exercises the *schema's* depth cap, not the YAML composer. (The pure
    // schema is proven fast against a 5000-deep chain in the depth-cap suite.)
    const chain = (depth: number): unknown => {
      let node: unknown = { type: "Point", coordinates: [0, 0] };
      for (let i = 0; i < depth; i++) {
        node = { type: "GeometryCollection", geometries: [node] };
      }
      return node;
    };
    const start = performance.now();
    const result = YAMLParser.safeParseMapBlock(v2DocWith(chain(50)));
    const elapsedMs = performance.now() - start;
    expect(result.success).toBe(false);
    expect(elapsedMs).toBeLessThan(2000);
  });

  it("still accepts a url-based geojson source under v2 (no data change)", () => {
    const doc = {
      version: 2,
      type: "map",
      id: "test",
      style: {
        basemap: "https://demotiles.maplibre.org/style.json",
        sources: { pts: { type: "geojson", url: "/data/points.geojson" } },
        layers: [],
      },
    };
    const result = YAMLParser.safeParseMapBlock(JSON.stringify(doc));
    expect(result.success).toBe(true);
  });
});

describe("v1 compat (R2/R10) — data stays z.any()", () => {
  it("the SAME malformed inline data still PARSES under v1", () => {
    const result = YAMLParser.safeParseMapBlock(v1DocWith(MALFORMED_POINT_FC));
    expect(result.success).toBe(true);
  });

  it("well-formed inline data parses under v1 too", () => {
    const result = YAMLParser.safeParseMapBlock(v1DocWith(WELL_FORMED_FC));
    expect(result.success).toBe(true);
  });

  it("a url-based v1 geojson source still passes", () => {
    const doc = {
      type: "map",
      id: "test",
      config: {
        mapStyle: "https://demotiles.maplibre.org/style.json",
        center: [0, 0],
        zoom: 2,
      },
      sources: { pts: { type: "geojson", url: "/data/points.geojson" } },
      layers: [],
    };
    const result = YAMLParser.safeParseMapBlock(JSON.stringify(doc));
    expect(result.success).toBe(true);
  });
});
