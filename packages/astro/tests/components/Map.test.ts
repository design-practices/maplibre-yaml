/**
 * @file Tests for Map component
 * @module @maplibre-yaml/astro/tests/components/Map
 */

import { describe, it, expect } from "vitest";

describe("Map Component Props", () => {
  it("validates MapProps interface with src", () => {
    // Type-level test - if this compiles, types are correct
    const validProps: import("../../src/types").MapProps = {
      src: "/configs/map.yaml",
      height: "500px",
    };

    expect(validProps).toBeDefined();
    expect(validProps.src).toBe("/configs/map.yaml");
    expect(validProps.height).toBe("500px");
  });

  it("accepts config prop", () => {
    const validProps: import("../../src/types").MapProps = {
      config: {
        type: "map",
        id: "test-map",
        config: {
          center: [0, 0],
          zoom: 2,
          mapStyle: "https://demotiles.maplibre.org/style.json",
        },
      },
      height: "400px",
    };

    expect(validProps.config).toBeDefined();
    expect(validProps.config?.id).toBe("test-map");
  });

  it("accepts className and style props", () => {
    const validProps: import("../../src/types").MapProps = {
      src: "/configs/map.yaml",
      class: "custom-map",
      style: "border: 2px solid #ccc;",
    };

    expect(validProps.class).toBe("custom-map");
    expect(validProps.style).toBe("border: 2px solid #ccc;");
  });

  it("allows optional height prop with default", () => {
    const propsWithoutHeight: import("../../src/types").MapProps = {
      src: "/configs/map.yaml",
    };

    expect(propsWithoutHeight.height).toBeUndefined();

    const propsWithHeight: import("../../src/types").MapProps = {
      src: "/configs/map.yaml",
      height: "600px",
    };

    expect(propsWithHeight.height).toBe("600px");
  });

  it("accepts config with layers", () => {
    const validProps: import("../../src/types").MapProps = {
      config: {
        type: "map",
        id: "layered-map",
        config: {
          center: [0, 0],
          zoom: 2,
          mapStyle: "https://demotiles.maplibre.org/style.json",
        },
        layers: [
          {
            id: "points",
            type: "circle",
            source: {
              type: "geojson",
              data: {
                type: "FeatureCollection",
                features: [],
              },
            },
            paint: {
              "circle-radius": 5,
              "circle-color": "#ff0000",
            },
          },
        ],
      },
    };

    expect(validProps.config?.layers).toBeDefined();
    expect(validProps.config?.layers).toHaveLength(1);
  });
});

describe("Map Component Integration", () => {
  it("uses YAMLParser from core", async () => {
    // Verify that YAMLParser is available from core
    // This is used by the runtime loading script in Map.astro
    const { YAMLParser } = await import("@maplibre-yaml/core");
    expect(YAMLParser).toBeDefined();
    expect(YAMLParser.safeParseMapBlock).toBeDefined();
    expect(typeof YAMLParser.safeParseMapBlock).toBe("function");
  });

  it("can parse valid map configuration", async () => {
    // Test that the parsing logic used in Map.astro works correctly
    const { YAMLParser } = await import("@maplibre-yaml/core");

    const yaml = `
type: map
id: test-map
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
`;

    const result = YAMLParser.safeParseMapBlock(yaml);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.id).toBe("test-map");
  });

  it("provides validation errors for invalid configs", async () => {
    // Test error handling used in Map.astro
    const { YAMLParser } = await import("@maplibre-yaml/core");

    const invalidYaml = `
type: map
id: bad-map
config:
  center: [999, 0]
  zoom: 100
  mapStyle: "https://example.com/style.json"
`;

    const result = YAMLParser.safeParseMapBlock(invalidYaml);

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("Map Component Type Safety", () => {
  it("ensures MapProps matches MapBlock type", () => {
    const mapBlock: import("@maplibre-yaml/core").MapBlock = {
      type: "map",
      id: "test",
      config: {
        center: [0, 0],
        zoom: 2,
        mapStyle: "https://demotiles.maplibre.org/style.json",
      },
    };

    const props: import("../../src/types").MapProps = {
      config: mapBlock,
    };

    expect(props.config).toEqual(mapBlock);
  });
});
