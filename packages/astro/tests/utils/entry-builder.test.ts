/**
 * @file Tests for buildMapConfigFromEntry
 * @module @maplibre-yaml/astro/tests/utils/entry-builder
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "path";
import { buildMapConfigFromEntry } from "../../src/utils/entry-builder";
import { clearFeatureCache } from "../../src/utils/feature-ref-loader";

const FIXTURE_PATH = resolve(__dirname, "../fixtures/sample.geojson");
const STYLE_URL = "https://example.com/style.json";
const STYLE = { defaultMapStyle: STYLE_URL };

describe("buildMapConfigFromEntry", () => {
  beforeEach(() => clearFeatureCache());
  afterEach(() => clearFeatureCache());

  describe("dispatch precedence", () => {
    it("feature_ref wins over all inline geometry fields", async () => {
      const config = await buildMapConfigFromEntry(
        {
          feature_ref: { source: FIXTURE_PATH, featureId: "polygon-4" },
          location: { coordinates: [-1, -1] }, // should be ignored
          region: { coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, // ignored
          route: { coordinates: [[0, 0], [1, 1]] }, // ignored
        },
        STYLE,
      );

      // Should be a polygon (from the polygon-4 feature), not a point or line
      expect(config.layers).toHaveLength(2);
      expect(config.layers[0]!.type).toBe("fill");
    });

    it("region wins over route, locations, location", async () => {
      const config = await buildMapConfigFromEntry(
        {
          region: { coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
          route: { coordinates: [[0, 0], [1, 1]] },
          locations: [{ coordinates: [0, 0] }],
          location: { coordinates: [0, 0] },
        },
        STYLE,
      );

      expect(config.layers[0]!.type).toBe("fill");
    });

    it("route wins over locations and location", async () => {
      const config = await buildMapConfigFromEntry(
        {
          route: { coordinates: [[0, 0], [1, 1]] },
          locations: [{ coordinates: [0, 0] }],
          location: { coordinates: [0, 0] },
        },
        STYLE,
      );

      expect(config.layers[0]!.type).toBe("line");
    });

    it("locations wins over location", async () => {
      const config = await buildMapConfigFromEntry(
        {
          locations: [
            { coordinates: [0, 0] },
            { coordinates: [1, 1] },
          ],
          location: { coordinates: [0, 0] },
        },
        STYLE,
      );

      expect(config.layers[0]!.type).toBe("circle");
      const layer = config.layers[0] as {
        source: { data: { features: unknown[] } };
      };
      // multi-point creates 2 features; single-point would be 1
      expect(layer.source.data.features).toHaveLength(2);
    });

    it("location used when only location is set", async () => {
      const config = await buildMapConfigFromEntry(
        { location: { coordinates: [-73.985, 40.674] } },
        STYLE,
      );

      expect(config.layers[0]!.type).toBe("circle");
      expect(config.config.center).toEqual([-73.985, 40.674]);
    });

    it("falls back to options.fallback when no geometry field is set", async () => {
      const config = await buildMapConfigFromEntry({}, STYLE, {
        fallback: { coordinates: [-73.985, 40.674], name: "Fallback" },
      });

      expect(config.layers[0]!.type).toBe("circle");
      expect(config.config.center).toEqual([-73.985, 40.674]);
    });

    it("throws when no geometry and no fallback", async () => {
      await expect(buildMapConfigFromEntry({}, STYLE)).rejects.toThrow(
        /no geometry field/,
      );
    });
  });

  describe("label and description defaults", () => {
    it("applies options.label when location.name is unset", async () => {
      const config = await buildMapConfigFromEntry(
        { location: { coordinates: [0, 0] } },
        STYLE,
        { label: "Default Title", description: "Default desc" },
      );

      const layer = config.layers[0] as {
        source: {
          data: { features: { properties: { name: string; description: string } }[] };
        };
      };
      expect(layer.source.data.features[0]!.properties.name).toBe(
        "Default Title",
      );
      expect(layer.source.data.features[0]!.properties.description).toBe(
        "Default desc",
      );
    });

    it("explicit name on geometry wins over label", async () => {
      const config = await buildMapConfigFromEntry(
        { location: { coordinates: [0, 0], name: "Explicit" } },
        STYLE,
        { label: "Default Title" },
      );

      const layer = config.layers[0] as {
        source: { data: { features: { properties: { name: string } }[] } };
      };
      expect(layer.source.data.features[0]!.properties.name).toBe("Explicit");
    });

    it("label flows through to feature_ref's name override", async () => {
      const config = await buildMapConfigFromEntry(
        {
          feature_ref: { source: FIXTURE_PATH, featureId: "point-1" },
          // Note: feature.properties.name on point-1 is "Library Site"
        },
        STYLE,
        { label: "Page Title" },
      );

      // ref.name was unset, so options.label should win over feature.properties.name
      const layer = config.layers[0] as {
        source: { data: { features: { properties: { name: string } }[] } };
      };
      expect(layer.source.data.features[0]!.properties.name).toBe("Page Title");
    });

    it("explicit feature_ref.name wins over label", async () => {
      const config = await buildMapConfigFromEntry(
        {
          feature_ref: {
            source: FIXTURE_PATH,
            featureId: "point-1",
            name: "Ref Override",
          },
        },
        STYLE,
        { label: "Page Title" },
      );

      const layer = config.layers[0] as {
        source: { data: { features: { properties: { name: string } }[] } };
      };
      expect(layer.source.data.features[0]!.properties.name).toBe(
        "Ref Override",
      );
    });
  });

  describe("globalConfig pass-through", () => {
    it("forwards globalConfig to underlying builders", async () => {
      const config = await buildMapConfigFromEntry(
        { location: { coordinates: [0, 0] } },
        { defaultMapStyle: "https://demotiles.maplibre.org/style.json" },
      );

      expect(config.config.mapStyle).toBe(
        "https://demotiles.maplibre.org/style.json",
      );
    });
  });

  describe("ignores extra fields", () => {
    it("entries with non-geometry fields work fine (ignores them)", async () => {
      const config = await buildMapConfigFromEntry(
        {
          title: "POA #1.1",
          gotf_id: 1.1,
          status: "Complete",
          location: { coordinates: [0, 0] },
        },
        STYLE,
      );

      expect(config.layers[0]!.type).toBe("circle");
    });
  });
});
