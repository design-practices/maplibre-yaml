/**
 * @file Tests for GeoJSONLoadError and findFeature
 * @module @maplibre-yaml/astro/tests/utils/feature-ref-loader
 */

import { describe, it, expect } from "vitest";
import type { Feature, FeatureCollection } from "geojson";
import {
  GeoJSONLoadError,
  findFeature,
} from "../../src/utils/feature-ref-loader";
import type { FeatureRef } from "../../src/utils/feature-ref-schema";

function makeFC(features: Feature[]): FeatureCollection {
  return { type: "FeatureCollection", features };
}

function pointFeature(
  id: string | number | undefined,
  properties: Record<string, unknown> | null = {},
  coords: [number, number] = [0, 0],
): Feature {
  const f: Feature = {
    type: "Feature",
    geometry: { type: "Point", coordinates: coords },
    properties,
  };
  if (id !== undefined) f.id = id;
  return f;
}

describe("GeoJSONLoadError", () => {
  it("is instanceof Error", () => {
    const err = new GeoJSONLoadError("msg", "/abs/path");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GeoJSONLoadError);
  });

  it("sets name to 'GeoJSONLoadError'", () => {
    const err = new GeoJSONLoadError("msg", "/p");
    expect(err.name).toBe("GeoJSONLoadError");
  });

  it("preserves filePath", () => {
    const err = new GeoJSONLoadError("msg", "/abs/path/file.geojson");
    expect(err.filePath).toBe("/abs/path/file.geojson");
  });

  it("accepts structured errors array", () => {
    const errors = [{ path: "features[0]", message: "missing geometry" }];
    const err = new GeoJSONLoadError("msg", "/p", errors);
    expect(err.errors).toEqual(errors);
  });

  it("defaults errors to empty array when omitted", () => {
    const err = new GeoJSONLoadError("msg", "/p");
    expect(err.errors).toEqual([]);
  });

  it("accepts ES2022 cause via options (forward-compat constraint #4)", () => {
    const inner = new Error("inner");
    const err = new GeoJSONLoadError("msg", "/p", [], { cause: inner });
    expect((err as { cause?: unknown }).cause).toBe(inner);
  });

  it("does not set cause when options.cause is undefined", () => {
    const err = new GeoJSONLoadError("msg", "/p", [], {});
    expect("cause" in err && (err as { cause?: unknown }).cause).toBeFalsy();
  });
});

describe("findFeature", () => {
  describe("match by featureId", () => {
    it("returns the feature with matching string id", () => {
      const fc = makeFC([
        pointFeature("a", {}, [0, 0]),
        pointFeature("poa-1.1", { gotf_id: 1.1 }, [1, 1]),
        pointFeature("c", {}, [2, 2]),
      ]);
      const ref: FeatureRef = { source: "x.geojson", featureId: "poa-1.1" };
      const result = findFeature(fc, ref);
      expect(result.id).toBe("poa-1.1");
      expect((result.properties as { gotf_id?: number })?.gotf_id).toBe(1.1);
    });

    it("returns the feature with matching numeric id", () => {
      const fc = makeFC([
        pointFeature(41, {}),
        pointFeature(42, { name: "answer" }),
        pointFeature(43, {}),
      ]);
      const ref: FeatureRef = { source: "x.geojson", featureId: 42 };
      const result = findFeature(fc, ref);
      expect(result.id).toBe(42);
    });

    it("does not coerce types: 42 does not match '42'", () => {
      const fc = makeFC([pointFeature("42", {}), pointFeature(42, {})]);
      const ref: FeatureRef = { source: "x.geojson", featureId: 42 };
      const result = findFeature(fc, ref);
      expect(result.id).toBe(42); // numeric, not string
    });
  });

  describe("match by property", () => {
    it("returns feature matching by string property", () => {
      const fc = makeFC([
        pointFeature(undefined, { gotf_id: "1.1", name: "first" }),
        pointFeature(undefined, { gotf_id: "1.2", name: "second" }),
      ]);
      const ref: FeatureRef = {
        source: "x.geojson",
        match: { property: "gotf_id", equals: "1.2" },
      };
      const result = findFeature(fc, ref);
      expect((result.properties as { name?: string })?.name).toBe("second");
    });

    it("returns feature matching by numeric property", () => {
      const fc = makeFC([
        pointFeature(undefined, { gotf_id: 1.1 }),
        pointFeature(undefined, { gotf_id: 1.2 }),
      ]);
      const ref: FeatureRef = {
        source: "x.geojson",
        match: { property: "gotf_id", equals: 1.2 },
      };
      const result = findFeature(fc, ref);
      expect((result.properties as { gotf_id?: number })?.gotf_id).toBe(1.2);
    });

    it("returns feature matching by boolean property", () => {
      const fc = makeFC([
        pointFeature(undefined, { active: true, name: "yes" }),
        pointFeature(undefined, { active: false, name: "no" }),
      ]);
      const ref: FeatureRef = {
        source: "x.geojson",
        match: { property: "active", equals: true },
      };
      const result = findFeature(fc, ref);
      expect((result.properties as { name?: string })?.name).toBe("yes");
    });

    it("safely skips features with null properties", () => {
      const fc = makeFC([
        pointFeature(undefined, null),
        pointFeature(undefined, { gotf_id: 1.1 }),
      ]);
      const ref: FeatureRef = {
        source: "x.geojson",
        match: { property: "gotf_id", equals: 1.1 },
      };
      // Should not throw on the null-properties feature
      const result = findFeature(fc, ref);
      expect((result.properties as { gotf_id?: number })?.gotf_id).toBe(1.1);
    });
  });

  describe("error: no match", () => {
    it("throws GeoJSONLoadError when featureId not found", () => {
      const fc = makeFC([
        pointFeature("a", {}),
        pointFeature("b", {}),
        pointFeature("c", {}),
      ]);
      const ref: FeatureRef = { source: "x.geojson", featureId: "missing" };

      try {
        findFeature(fc, ref);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(GeoJSONLoadError);
        const message = (err as Error).message;
        expect(message).toMatch(/missing/);
        expect(message).toMatch(/x\.geojson/);
        expect(message).toMatch(/3 features/);
        expect(message).toMatch(/Sample ids/);
      }
    });

    it("throws GeoJSONLoadError when property match returns nothing", () => {
      const fc = makeFC([
        pointFeature(undefined, { gotf_id: 1 }),
        pointFeature(undefined, { gotf_id: 2 }),
      ]);
      const ref: FeatureRef = {
        source: "x.geojson",
        match: { property: "gotf_id", equals: 99 },
      };

      try {
        findFeature(fc, ref);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(GeoJSONLoadError);
        const message = (err as Error).message;
        expect(message).toMatch(/gotf_id/);
        expect(message).toMatch(/99/);
        expect(message).toMatch(/2 features checked/);
        expect(message).toMatch(/Sample values/);
      }
    });
  });

  describe("error: multiple matches", () => {
    it("throws when featureId matches multiple features", () => {
      const fc = makeFC([
        pointFeature("a", {}),
        pointFeature("dup", {}),
        pointFeature("dup", {}),
        pointFeature("c", {}),
      ]);
      const ref: FeatureRef = { source: "x.geojson", featureId: "dup" };

      try {
        findFeature(fc, ref);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(GeoJSONLoadError);
        const message = (err as Error).message;
        expect(message).toMatch(/2 features/);
        expect(message).toMatch(/V1 requires exactly one match/);
        expect(message).toMatch(/more specific/);
      }
    });

    it("throws when property match returns multiple features", () => {
      const fc = makeFC([
        pointFeature(undefined, { gotf_id: 1.1 }),
        pointFeature(undefined, { gotf_id: 1.1 }),
      ]);
      const ref: FeatureRef = {
        source: "x.geojson",
        match: { property: "gotf_id", equals: 1.1 },
      };

      try {
        findFeature(fc, ref);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(GeoJSONLoadError);
        const message = (err as Error).message;
        expect(message).toMatch(/2 features/);
        expect(message).toMatch(/Sample matches/);
      }
    });
  });

  describe("error: invalid input", () => {
    it("throws when given non-FeatureCollection", () => {
      const fc = { type: "Feature" } as unknown as FeatureCollection;
      const ref: FeatureRef = { source: "x.geojson", featureId: "x" };

      expect(() => findFeature(fc, ref)).toThrow(GeoJSONLoadError);
      expect(() => findFeature(fc, ref)).toThrow(/FeatureCollection/);
    });
  });

  describe("purity", () => {
    it("does not modify the input FeatureCollection", () => {
      const fc = makeFC([
        pointFeature("a", { gotf_id: 1 }),
        pointFeature("b", { gotf_id: 2 }),
      ]);
      const beforeLen = fc.features.length;
      const beforeFirstId = fc.features[0]!.id;

      findFeature(fc, { source: "x.geojson", featureId: "a" });

      expect(fc.features.length).toBe(beforeLen);
      expect(fc.features[0]!.id).toBe(beforeFirstId);
    });
  });
});
