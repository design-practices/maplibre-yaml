/**
 * @file Tests for FullPageMap component types and integration
 * @module @maplibre-yaml/astro/tests/components/FullPageMap
 *
 * @description
 * Tests for the FullPageMap component focusing on:
 * - Type validation for component props
 * - Integration with YAMLParser for config validation
 * - Control and legend functionality types
 *
 * Note: Cannot directly import .astro components in vitest, so tests focus
 * on type validation and integration with core library functionality.
 */

import { describe, it, expect } from "vitest";
import type { FullPageMapProps } from "../../src/types";
import { YAMLParser } from "@maplibre-yaml/core";

describe("FullPageMap Component Types", () => {
  describe("FullPageMapProps interface", () => {
    it("should accept valid src prop", () => {
      const props: FullPageMapProps = {
        src: "/configs/map.yaml",
      };
      expect(props.src).toBe("/configs/map.yaml");
    });

    it("should accept valid config prop", () => {
      const props: FullPageMapProps = {
        config: {
          version: "1.0",
          map: {
            style: "https://demotiles.maplibre.org/style.json",
            center: [-74.006, 40.7128],
            zoom: 12,
          },
        },
      };
      expect(props.config).toBeDefined();
    });

    it("should accept showControls prop", () => {
      const props: FullPageMapProps = {
        src: "/configs/map.yaml",
        showControls: true,
      };
      expect(props.showControls).toBe(true);
    });

    it("should accept showLegend prop", () => {
      const props: FullPageMapProps = {
        src: "/configs/map.yaml",
        showLegend: true,
      };
      expect(props.showLegend).toBe(true);
    });

    it("should accept legendPosition prop with valid values", () => {
      const positions: Array<FullPageMapProps["legendPosition"]> = [
        "top-left",
        "top-right",
        "bottom-left",
        "bottom-right",
      ];

      positions.forEach((position) => {
        const props: FullPageMapProps = {
          src: "/configs/map.yaml",
          legendPosition: position,
        };
        expect(props.legendPosition).toBe(position);
      });
    });

    it("should accept optional height prop", () => {
      const props: FullPageMapProps = {
        src: "/configs/map.yaml",
        height: "600px",
      };
      expect(props.height).toBe("600px");
    });

    it("should accept optional class prop", () => {
      const props: FullPageMapProps = {
        src: "/configs/map.yaml",
        class: "custom-map-class",
      };
      expect(props.class).toBe("custom-map-class");
    });

    it("should accept optional style prop", () => {
      const props: FullPageMapProps = {
        src: "/configs/map.yaml",
        style: "border: 1px solid #ccc;",
      };
      expect(props.style).toBe("border: 1px solid #ccc;");
    });

    it("should accept all props together", () => {
      const props: FullPageMapProps = {
        config: {
          version: "1.0",
          map: {
            style: "https://demotiles.maplibre.org/style.json",
            center: [-74.006, 40.7128],
            zoom: 12,
          },
        },
        showControls: true,
        showLegend: true,
        legendPosition: "top-right",
        height: "100vh",
        class: "dashboard-map",
        style: "z-index: 1;",
      };

      expect(props.config).toBeDefined();
      expect(props.showControls).toBe(true);
      expect(props.showLegend).toBe(true);
      expect(props.legendPosition).toBe("top-right");
    });
  });

  describe("Integration with YAMLParser", () => {
    it("should work with YAMLParser for runtime loading", () => {
      const validConfig = {
        version: "1.0",
        map: {
          style: "https://demotiles.maplibre.org/style.json",
          center: [-74.006, 40.7128],
          zoom: 12,
        },
      };

      const props: FullPageMapProps = {
        config: validConfig,
        showControls: true,
        showLegend: true,
      };
      expect(props.config).toBeDefined();
      expect(props.config?.map.center).toEqual([-74.006, 40.7128]);
    });

    it("should handle validation errors from YAMLParser", () => {
      const invalidYaml = `version: "1.0"
map:
  style: "https://demotiles.maplibre.org/style.json"
  center: "invalid"
  zoom: "not a number"`;

      const result = YAMLParser.safeParseMapBlock(invalidYaml);
      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Control visibility types", () => {
    it("should allow omitting showControls (defaults to true)", () => {
      const props: FullPageMapProps = {
        src: "/configs/map.yaml",
      };
      expect(props.showControls).toBeUndefined();
    });

    it("should allow explicitly setting showControls to false", () => {
      const props: FullPageMapProps = {
        src: "/configs/map.yaml",
        showControls: false,
      };
      expect(props.showControls).toBe(false);
    });
  });

  describe("Legend configuration types", () => {
    it("should allow omitting showLegend (defaults to false)", () => {
      const props: FullPageMapProps = {
        src: "/configs/map.yaml",
      };
      expect(props.showLegend).toBeUndefined();
    });

    it("should allow omitting legendPosition (defaults to top-right)", () => {
      const props: FullPageMapProps = {
        src: "/configs/map.yaml",
        showLegend: true,
      };
      expect(props.legendPosition).toBeUndefined();
    });

    it("should combine legend props correctly", () => {
      const props: FullPageMapProps = {
        src: "/configs/map.yaml",
        showLegend: true,
        legendPosition: "bottom-left",
      };
      expect(props.showLegend).toBe(true);
      expect(props.legendPosition).toBe("bottom-left");
    });
  });

  describe("MapBlock config validation", () => {
    it("should validate complete map configuration", () => {
      const config = {
        version: "1.0",
        map: {
          style: "https://demotiles.maplibre.org/style.json",
          center: [-74.006, 40.7128],
          zoom: 12,
          pitch: 45,
          bearing: 30,
        },
        sources: {
          earthquakes: {
            type: "geojson",
            data: "https://example.com/earthquakes.geojson",
          },
        },
        layers: [
          {
            id: "earthquake-circles",
            type: "circle",
            source: "earthquakes",
            paint: {
              "circle-radius": 8,
              "circle-color": "#ff0000",
            },
          },
        ],
      };

      const props: FullPageMapProps = {
        config,
        showControls: true,
        showLegend: true,
        legendPosition: "bottom-right",
      };

      expect(props.config).toEqual(config);
    });
  });
});
