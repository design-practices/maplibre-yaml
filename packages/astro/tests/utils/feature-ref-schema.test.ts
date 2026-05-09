/**
 * @file Tests for FeatureRefSchema and getCollectionItemWithFeatureRefSchema
 * @module @maplibre-yaml/astro/tests/utils/feature-ref-schema
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  FeatureRefSchema,
  assertValidFeatureRef,
  InvalidFeatureRefError,
  getCollectionItemWithFeatureRefSchema,
  type FeatureRef,
} from "../../src/utils/feature-ref-schema";

describe("FeatureRefSchema", () => {
  describe("happy paths", () => {
    it("accepts featureId form with string id", () => {
      const result = FeatureRefSchema.parse({
        source: "./data.geojson",
        featureId: "poa-1.1",
      });
      expect(result).toMatchObject({
        source: "./data.geojson",
        featureId: "poa-1.1",
      });
    });

    it("accepts featureId form with numeric id", () => {
      const result = FeatureRefSchema.parse({
        source: "./data.geojson",
        featureId: 42,
      });
      expect(result).toMatchObject({
        source: "./data.geojson",
        featureId: 42,
      });
    });

    it("accepts match form with string equals", () => {
      const result = FeatureRefSchema.parse({
        source: "./data.geojson",
        match: { property: "gotf_id", equals: "1.1" },
      });
      expect(result).toMatchObject({
        source: "./data.geojson",
        match: { property: "gotf_id", equals: "1.1" },
      });
    });

    it("accepts match form with numeric equals", () => {
      const result = FeatureRefSchema.parse({
        source: "./data.geojson",
        match: { property: "gotf_id", equals: 1.1 },
      });
      expect(result).toMatchObject({
        match: { property: "gotf_id", equals: 1.1 },
      });
    });

    it("accepts match form with boolean equals", () => {
      const result = FeatureRefSchema.parse({
        source: "./data.geojson",
        match: { property: "active", equals: true },
      });
      expect(result).toMatchObject({
        match: { property: "active", equals: true },
      });
    });

    it("accepts optional override fields", () => {
      const result = FeatureRefSchema.parse({
        source: "./data.geojson",
        featureId: "x",
        name: "Override Name",
        description: "Override description",
        zoom: 16,
        markerColor: "#e74c3c",
      });
      expect(result).toMatchObject({
        name: "Override Name",
        description: "Override description",
        zoom: 16,
        markerColor: "#e74c3c",
      });
    });

    it("accepts polygon style overrides", () => {
      const result = FeatureRefSchema.parse({
        source: "./data.geojson",
        featureId: "x",
        fillColor: "#3388ff",
        strokeColor: "#000",
        fillOpacity: 0.5,
      });
      expect(result).toMatchObject({
        fillColor: "#3388ff",
        strokeColor: "#000",
        fillOpacity: 0.5,
      });
    });

    it("accepts line style overrides", () => {
      const result = FeatureRefSchema.parse({
        source: "./data.geojson",
        featureId: "x",
        color: "#ff0000",
        width: 4,
      });
      expect(result).toMatchObject({ color: "#ff0000", width: 4 });
    });
  });

  describe("error paths", () => {
    // NOTE: The XOR check (featureId vs match) is enforced by
    // `assertValidFeatureRef` and runs inside `buildFeatureMapConfig` --
    // not by the schema itself. The schema is a plain ZodObject (no
    // .superRefine) for Astro 5 content-layer compatibility.
    it("schema accepts a ref with neither featureId nor match (XOR enforced at build time)", () => {
      const result = FeatureRefSchema.parse({ source: "./data.geojson" });
      expect(result).toMatchObject({ source: "./data.geojson" });
    });

    it("schema accepts a ref with both featureId and match (XOR enforced at build time)", () => {
      const result = FeatureRefSchema.parse({
        source: "./data.geojson",
        featureId: "x",
        match: { property: "y", equals: 1 },
      });
      expect(result).toMatchObject({ featureId: "x" });
      expect(result).toMatchObject({ match: { property: "y", equals: 1 } });
    });

    it("rejects zoom outside [0, 24]", () => {
      expect(() =>
        FeatureRefSchema.parse({
          source: "./data.geojson",
          featureId: "x",
          zoom: 25,
        }),
      ).toThrow();

      expect(() =>
        FeatureRefSchema.parse({
          source: "./data.geojson",
          featureId: "x",
          zoom: -1,
        }),
      ).toThrow();
    });

    it("rejects fillOpacity outside [0, 1]", () => {
      expect(() =>
        FeatureRefSchema.parse({
          source: "./data.geojson",
          featureId: "x",
          fillOpacity: 1.5,
        }),
      ).toThrow();
    });

    it("rejects width <= 0", () => {
      expect(() =>
        FeatureRefSchema.parse({
          source: "./data.geojson",
          featureId: "x",
          width: 0,
        }),
      ).toThrow();
    });

    it("rejects missing source", () => {
      expect(() =>
        FeatureRefSchema.parse({ featureId: "x" }),
      ).toThrow();
    });
  });

  describe("forward-compatibility", () => {
    it("accepts unknown future keys on the match object without throwing", () => {
      // This test enforces Forward Compatibility constraint #1: the match
      // schema must NOT use .strict(). V2 may add keys like 'all', 'any',
      // 'in', 'filter' -- they should pass schema validation as ignored.
      const result = FeatureRefSchema.parse({
        source: "./data.geojson",
        match: {
          property: "x",
          equals: 1,
          // Future V2 keys
          all: ["dummy"],
          futureKey: "ignored",
        } as unknown as { property: string; equals: number },
      });
      expect(result).toMatchObject({
        match: { property: "x", equals: 1 },
      });
    });
  });

  describe("type inference", () => {
    it("FeatureRef type is exported and usable", () => {
      const ref: FeatureRef = {
        source: "./x.geojson",
        featureId: "y",
      };
      expect(ref.source).toBe("./x.geojson");
    });
  });
});

describe("assertValidFeatureRef", () => {
  it("accepts a ref with only featureId", () => {
    expect(() =>
      assertValidFeatureRef({ source: "x", featureId: "a" }),
    ).not.toThrow();
  });

  it("accepts a ref with only match", () => {
    expect(() =>
      assertValidFeatureRef({
        source: "x",
        match: { property: "p", equals: 1 },
      }),
    ).not.toThrow();
  });

  it("rejects a ref with neither featureId nor match", () => {
    expect(() =>
      assertValidFeatureRef({ source: "x" } as FeatureRef),
    ).toThrow(/either.+featureId.+or.+match/);
  });

  it("rejects a ref with both featureId and match", () => {
    expect(() =>
      assertValidFeatureRef({
        source: "x",
        featureId: "a",
        match: { property: "p", equals: 1 },
      }),
    ).toThrow(/exactly one of.+featureId.+or.+match/);
  });

  it("throws InvalidFeatureRefError (discriminable subclass)", () => {
    try {
      assertValidFeatureRef({ source: "x" } as FeatureRef);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidFeatureRefError);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe("InvalidFeatureRefError");
    }
  });
});

describe("getCollectionItemWithFeatureRefSchema", () => {
  describe("happy paths", () => {
    it("accepts item with only feature_ref set", () => {
      const schema = getCollectionItemWithFeatureRefSchema();
      const result = schema.parse({
        feature_ref: { source: "./d.geojson", featureId: "x" },
      });
      expect(result).toMatchObject({
        feature_ref: { source: "./d.geojson", featureId: "x" },
      });
    });

    it("accepts item with only inline location set", () => {
      const schema = getCollectionItemWithFeatureRefSchema();
      const result = schema.parse({
        location: { coordinates: [-73.985, 40.674] },
      });
      expect(result).toMatchObject({
        location: { coordinates: [-73.985, 40.674] },
      });
    });

    it("accepts item with only inline region set", () => {
      const schema = getCollectionItemWithFeatureRefSchema();
      const result = schema.parse({
        region: { coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      });
      expect((result as { region: unknown }).region).toBeDefined();
    });

    it("accepts item with only inline route set", () => {
      const schema = getCollectionItemWithFeatureRefSchema();
      const result = schema.parse({
        route: { coordinates: [[0, 0], [1, 1]] },
      });
      expect((result as { route: unknown }).route).toBeDefined();
    });

    it("accepts item with no geometry fields set (all optional)", () => {
      const schema = getCollectionItemWithFeatureRefSchema();
      const result = schema.parse({});
      expect(result).toEqual({});
    });
  });

  describe("mutual exclusivity", () => {
    it("rejects feature_ref + location coexistence", () => {
      const schema = getCollectionItemWithFeatureRefSchema();
      expect(() =>
        schema.parse({
          feature_ref: { source: "./d.geojson", featureId: "x" },
          location: { coordinates: [0, 0] },
        }),
      ).toThrow(/feature_ref.*alongside.*location/);
    });

    it("rejects feature_ref + region coexistence", () => {
      const schema = getCollectionItemWithFeatureRefSchema();
      expect(() =>
        schema.parse({
          feature_ref: { source: "./d.geojson", featureId: "x" },
          region: { coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        }),
      ).toThrow(/feature_ref.*alongside.*region/);
    });

    it("rejects feature_ref + route coexistence", () => {
      const schema = getCollectionItemWithFeatureRefSchema();
      expect(() =>
        schema.parse({
          feature_ref: { source: "./d.geojson", featureId: "x" },
          route: { coordinates: [[0, 0], [1, 1]] },
        }),
      ).toThrow(/feature_ref.*alongside.*route/);
    });

    it("rejects feature_ref + locations coexistence", () => {
      const schema = getCollectionItemWithFeatureRefSchema();
      expect(() =>
        schema.parse({
          feature_ref: { source: "./d.geojson", featureId: "x" },
          locations: [{ coordinates: [0, 0] }],
        }),
      ).toThrow(/feature_ref.*alongside.*locations/);
    });

    it("error names all conflicting fields when several are present", () => {
      const schema = getCollectionItemWithFeatureRefSchema();
      try {
        schema.parse({
          feature_ref: { source: "./d.geojson", featureId: "x" },
          location: { coordinates: [0, 0] },
          region: { coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
          route: { coordinates: [[0, 0], [1, 1]] },
        });
        expect.fail("Expected schema.parse to throw");
      } catch (err) {
        const msg = (err as z.ZodError).message;
        expect(msg).toMatch(/location/);
        expect(msg).toMatch(/region/);
        expect(msg).toMatch(/route/);
      }
    });
  });

  describe("custom field extension", () => {
    it("accepts custom fields alongside geometry fields", () => {
      const schema = getCollectionItemWithFeatureRefSchema({
        title: z.string(),
        gotf_id: z.number(),
      });

      const result = schema.parse({
        title: "Test POA",
        gotf_id: 1.1,
        feature_ref: { source: "./d.geojson", featureId: "x" },
      });

      expect(result).toMatchObject({
        title: "Test POA",
        gotf_id: 1.1,
        feature_ref: { source: "./d.geojson", featureId: "x" },
      });
    });

    it("custom fields version still enforces mutual exclusivity", () => {
      const schema = getCollectionItemWithFeatureRefSchema({
        title: z.string(),
      });

      expect(() =>
        schema.parse({
          title: "x",
          feature_ref: { source: "./d.geojson", featureId: "x" },
          location: { coordinates: [0, 0] },
        }),
      ).toThrow(/feature_ref.*alongside.*location/);
    });
  });
});
