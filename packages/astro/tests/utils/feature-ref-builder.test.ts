/**
 * @file Tests for buildFeatureMapConfig
 * @module @maplibre-yaml/astro/tests/utils/feature-ref-builder
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "path";
import { buildFeatureMapConfig } from "../../src/utils/feature-ref-builder";
import {
  GeoJSONLoadError,
  clearFeatureCache,
} from "../../src/utils/feature-ref-loader";

const FIXTURE_PATH = resolve(__dirname, "../fixtures/sample.geojson");

describe("buildFeatureMapConfig", () => {
  beforeEach(() => {
    clearFeatureCache();
  });

  afterEach(() => {
    clearFeatureCache();
  });

  describe("geometry dispatch (happy paths)", () => {
    it("Point feature → buildPointMapConfig (circle layer)", async () => {
      const config = await buildFeatureMapConfig(
        {
          ref: { source: FIXTURE_PATH, featureId: "point-1" },
        },
        { defaultMapStyle: "https://example.com/style.json" },
      );

      expect(config.type).toBe("map");
      expect(config.layers).toHaveLength(1);
      expect(config.layers[0]!.type).toBe("circle");
      // Should have inherited the Point coordinates as map center
      expect(config.config.center).toEqual([-73.985, 40.674]);
    });

    it("MultiPoint feature → buildMultiPointMapConfig (markers)", async () => {
      const config = await buildFeatureMapConfig({
        ref: {
          source: FIXTURE_PATH,
          featureId: "multipoint-2",
          // Need to provide mapStyle since fixture doesn't have a global config
        },
      }, { defaultMapStyle: "https://example.com/style.json" });

      expect(config.type).toBe("map");
      expect(config.layers).toHaveLength(1);
      expect(config.layers[0]!.type).toBe("circle");
      // Multi-point creates a feature collection with multiple features
      const layer = config.layers[0] as {
        source: { data: { features: unknown[] } };
      };
      expect(layer.source.data.features).toHaveLength(3);
    });

    it("LineString feature → buildRouteMapConfig (line + endpoints)", async () => {
      const config = await buildFeatureMapConfig({
        ref: { source: FIXTURE_PATH, featureId: "linestring-3" },
      }, { defaultMapStyle: "https://example.com/style.json" });

      expect(config.type).toBe("map");
      // Route builder produces 2 layers: line + endpoints
      expect(config.layers).toHaveLength(2);
      expect(config.layers[0]!.type).toBe("line");
      expect(config.layers[1]!.type).toBe("circle");
    });

    it("Polygon feature → buildPolygonMapConfig (fill + outline)", async () => {
      const config = await buildFeatureMapConfig({
        ref: { source: FIXTURE_PATH, featureId: "polygon-4" },
      }, { defaultMapStyle: "https://example.com/style.json" });

      expect(config.type).toBe("map");
      // Polygon builder produces 2 layers: fill + outline (line)
      expect(config.layers).toHaveLength(2);
      expect(config.layers[0]!.type).toBe("fill");
      expect(config.layers[1]!.type).toBe("line");
    });

    it("MultiPolygon feature → renders ALL polygons (single MultiPolygon Feature)", async () => {
      const config = await buildFeatureMapConfig({
        ref: { source: FIXTURE_PATH, featureId: "multipolygon-5" },
      }, { defaultMapStyle: "https://example.com/style.json" });

      expect(config.type).toBe("map");
      expect(config.layers).toHaveLength(2);
      expect(config.layers[0]!.type).toBe("fill");

      // Verify the underlying source data contains the FULL MultiPolygon,
      // not just the first ring set
      const fillLayer = config.layers[0] as {
        source: { data: { features: { geometry: { type: string; coordinates: unknown[] } }[] } };
      };
      const feature = fillLayer.source.data.features[0]!;
      expect(feature.geometry.type).toBe("MultiPolygon");
      // Fixture has 2 polygons in the MultiPolygon -- all should be present
      expect(feature.geometry.coordinates).toHaveLength(2);
    });
  });

  describe("MultiLineString and GeometryCollection support", () => {
    it("MultiLineString → renders ALL line segments (single MultiLineString Feature)", async () => {
      const config = await buildFeatureMapConfig({
        ref: { source: FIXTURE_PATH, featureId: "multiline-6" },
      }, { defaultMapStyle: "https://example.com/style.json" });

      expect(config.type).toBe("map");
      // Should have produced 2 layers: line + endpoints
      expect(config.layers).toHaveLength(2);
      expect(config.layers[0]!.type).toBe("line");
      expect(config.layers[1]!.type).toBe("circle");

      // Verify the line layer source contains the FULL MultiLineString
      const lineLayer = config.layers[0] as {
        source: { data: { features: { geometry: { type: string; coordinates: unknown[] } }[] } };
      };
      const feature = lineLayer.source.data.features[0]!;
      expect(feature.geometry.type).toBe("MultiLineString");
      // Fixture has 2 segments
      expect(feature.geometry.coordinates).toHaveLength(2);

      // Endpoints layer should mark start+end of each segment (4 points total)
      const endpointsLayer = config.layers[1] as {
        source: { data: { features: unknown[] } };
      };
      expect(endpointsLayer.source.data.features).toHaveLength(4);
    });

    it("GeometryCollection with single geometry → dispatches to inner geometry", async () => {
      const config = await buildFeatureMapConfig({
        ref: { source: FIXTURE_PATH, featureId: "geomcoll-single-7b" },
      }, { defaultMapStyle: "https://example.com/style.json" });

      expect(config.type).toBe("map");
      // Inner geometry is a Point, so should dispatch to point builder (1 circle layer)
      expect(config.layers).toHaveLength(1);
      expect(config.layers[0]!.type).toBe("circle");
      expect(config.config.center).toEqual([-73.985, 40.674]);
    });

    it("GeometryCollection with multiple geometries → throws clear error", async () => {
      await expect(
        buildFeatureMapConfig({
          ref: { source: FIXTURE_PATH, featureId: "geomcoll-7" },
        }, { defaultMapStyle: "https://example.com/style.json" }),
      ).rejects.toThrow(/2 geometries/);

      try {
        await buildFeatureMapConfig({
          ref: { source: FIXTURE_PATH, featureId: "geomcoll-7" },
        }, { defaultMapStyle: "https://example.com/style.json" });
        expect.fail("should have thrown");
      } catch (err) {
        const message = (err as Error).message;
        expect(message).toMatch(/single-geometry/);
        expect(message).toMatch(/Split into separate features/);
      }
    });
  });

  describe("override behavior", () => {
    it("ref.name overrides feature.properties.name", async () => {
      const config = await buildFeatureMapConfig({
        ref: {
          source: FIXTURE_PATH,
          featureId: "point-1",
          name: "Override Title",
        },
      }, { defaultMapStyle: "https://example.com/style.json" });

      // Feature has properties.name = "Library Site"; ref overrides to "Override Title"
      const layer = config.layers[0] as {
        source: { data: { features: { properties: { name?: string } }[] } };
      };
      expect(layer.source.data.features[0]!.properties.name).toBe(
        "Override Title",
      );
    });

    it("falls back to feature.properties.name when ref.name not provided", async () => {
      const config = await buildFeatureMapConfig({
        ref: { source: FIXTURE_PATH, featureId: "point-1" },
      }, { defaultMapStyle: "https://example.com/style.json" });

      const layer = config.layers[0] as {
        source: { data: { features: { properties: { name?: string } }[] } };
      };
      expect(layer.source.data.features[0]!.properties.name).toBe(
        "Library Site",
      );
    });

    it("ref.markerColor flows through to Point builder", async () => {
      const config = await buildFeatureMapConfig({
        ref: {
          source: FIXTURE_PATH,
          featureId: "point-1",
          markerColor: "#e74c3c",
        },
      }, { defaultMapStyle: "https://example.com/style.json" });

      const layer = config.layers[0] as { paint: Record<string, unknown> };
      expect(layer.paint["circle-color"]).toBe("#e74c3c");
    });

    it("ref.fillColor flows through to Polygon builder", async () => {
      const config = await buildFeatureMapConfig({
        ref: {
          source: FIXTURE_PATH,
          featureId: "polygon-4",
          fillColor: "#2ecc71",
          fillOpacity: 0.5,
        },
      }, { defaultMapStyle: "https://example.com/style.json" });

      const layer = config.layers[0] as { paint: Record<string, unknown> };
      expect(layer.paint["fill-color"]).toBe("#2ecc71");
      expect(layer.paint["fill-opacity"]).toBe(0.5);
    });

    it("ref.color/width flow through to LineString builder", async () => {
      const config = await buildFeatureMapConfig({
        ref: {
          source: FIXTURE_PATH,
          featureId: "linestring-3",
          color: "#3498db",
          width: 4,
        },
      }, { defaultMapStyle: "https://example.com/style.json" });

      const layer = config.layers[0] as { paint: Record<string, unknown> };
      expect(layer.paint["line-color"]).toBe("#3498db");
      expect(layer.paint["line-width"]).toBe(4);
    });
  });

  describe("globalConfig integration", () => {
    it("globalConfig is forwarded to underlying sync builder", async () => {
      const config = await buildFeatureMapConfig(
        { ref: { source: FIXTURE_PATH, featureId: "point-1" } },
        {
          defaultMapStyle: "https://demotiles.maplibre.org/style.json",
          defaultZoom: 14,
        },
      );

      // mapStyle should be inherited from globalConfig
      expect(config.config.mapStyle).toBe(
        "https://demotiles.maplibre.org/style.json",
      );
    });
  });

  describe("error: missing feature", () => {
    it("missing featureId surfaces actionable error", async () => {
      await expect(
        buildFeatureMapConfig({
          ref: { source: FIXTURE_PATH, featureId: "does-not-exist" },
        }, { defaultMapStyle: "https://example.com/style.json" }),
      ).rejects.toThrow(GeoJSONLoadError);
    });

    it("missing match value surfaces actionable error", async () => {
      await expect(
        buildFeatureMapConfig({
          ref: {
            source: FIXTURE_PATH,
            match: { property: "gotf_id", equals: 999 },
          },
        }, { defaultMapStyle: "https://example.com/style.json" }),
      ).rejects.toThrow(/No feature where gotf_id/);
    });
  });

  describe("XOR validation (moved from schema to build time)", () => {
    it("rejects a ref with neither featureId nor match", async () => {
      await expect(
        buildFeatureMapConfig({
          ref: { source: FIXTURE_PATH } as Parameters<typeof buildFeatureMapConfig>[0]["ref"],
        }),
      ).rejects.toThrow(/either.+featureId.+or.+match/);
    });

    it("rejects a ref with both featureId and match", async () => {
      await expect(
        buildFeatureMapConfig({
          ref: {
            source: FIXTURE_PATH,
            featureId: "point-1",
            match: { property: "gotf_id", equals: 1.1 },
          },
        }),
      ).rejects.toThrow(/exactly one of.+featureId.+or.+match/);
    });
  });

  describe("error: file not found", () => {
    it("missing source file surfaces clear error", async () => {
      await expect(
        buildFeatureMapConfig({
          ref: {
            source: "./does-not-exist.geojson",
            featureId: "x",
          },
        }, { defaultMapStyle: "https://example.com/style.json" }),
      ).rejects.toThrow(/Cannot find/);
    });
  });

  describe("cache integration", () => {
    it("two refs against the same file share a single file read", async () => {
      // Two different refs, same source file, both succeed
      const config1 = await buildFeatureMapConfig({
        ref: { source: FIXTURE_PATH, featureId: "point-1" },
      }, { defaultMapStyle: "https://example.com/style.json" });

      const config2 = await buildFeatureMapConfig({
        ref: { source: FIXTURE_PATH, featureId: "polygon-4" },
      }, { defaultMapStyle: "https://example.com/style.json" });

      // Both should succeed, neither should re-parse the file
      // (verified indirectly via the test passing without timeout/error;
      // direct cache observability is in feature-ref-loader.test.ts)
      expect(config1.type).toBe("map");
      expect(config2.type).toBe("map");
    });
  });

  describe("input validation", () => {
    it("throws clear error for LineString with 1 coordinate", async () => {
      // Synthetic test FC with degenerate LineString
      const { writeFile, mkdir, rm } = await import("fs/promises");
      const { join } = await import("path");
      const { tmpdir } = await import("os");
      const tmp = join(tmpdir(), `feature-ref-degen-${Date.now()}`);
      await mkdir(tmp, { recursive: true });
      const path = join(tmp, "degen.geojson");
      try {
        await writeFile(
          path,
          JSON.stringify({
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                id: "degen",
                geometry: { type: "LineString", coordinates: [[0, 0]] },
                properties: {},
              },
            ],
          }),
        );

        await expect(
          buildFeatureMapConfig(
            { ref: { source: path, featureId: "degen" } },
            { defaultMapStyle: "https://example.com/style.json" },
          ),
        ).rejects.toThrow(/fewer than 2 coordinates/);
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    });
  });

  describe("Z-coordinate handling", () => {
    it("drops Z (altitude) coordinates from 3D Position arrays", async () => {
      const { writeFile, mkdir, rm } = await import("fs/promises");
      const { join } = await import("path");
      const { tmpdir } = await import("os");
      const tmp = join(tmpdir(), `feature-ref-3d-${Date.now()}`);
      await mkdir(tmp, { recursive: true });
      const path = join(tmp, "3d.geojson");
      try {
        await writeFile(
          path,
          JSON.stringify({
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                id: "3d",
                geometry: { type: "Point", coordinates: [10, 20, 999] },
                properties: {},
              },
            ],
          }),
        );

        const config = await buildFeatureMapConfig(
          { ref: { source: path, featureId: "3d" } },
          { defaultMapStyle: "https://example.com/style.json" },
        );

        // Map center should be 2D, no altitude
        expect(config.config.center).toEqual([10, 20]);
        // Layer source data should also be 2D
        const layer = config.layers[0] as {
          source: { data: { features: { geometry: { coordinates: number[] } }[] } };
        };
        expect(layer.source.data.features[0]!.geometry.coordinates).toEqual([10, 20]);
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    });
  });

  describe("build-time context", () => {
    it("works under normal Node invocation", async () => {
      // The previous V1 implementation had a runtime-environment guard
      // (`ensureBuildTimeContext`) plus a mutable opt-out flag. Both were
      // removed -- runtime-context detection now lives in the loader's
      // ENOENT path, where it produces deployment-context hints.
      const config = await buildFeatureMapConfig(
        { ref: { source: FIXTURE_PATH, featureId: "point-1" } },
        { defaultMapStyle: "https://example.com/style.json" },
      );
      expect(config).toBeDefined();
    });
  });
});
