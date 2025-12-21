/**
 * @file Tests for map schemas
 * @module @maplibre-yaml/core/tests/schemas/map
 */

import { describe, it, expect } from "vitest";
import {
  ControlPositionSchema,
  ControlsConfigSchema,
  LegendConfigSchema,
  MapConfigSchema,
  MapBlockSchema,
  MapFullPageBlockSchema,
} from "../../src/schemas/map.schema";

describe("ControlPositionSchema", () => {
  it("accepts all valid positions", () => {
    expect(ControlPositionSchema.parse("top-left")).toBe("top-left");
    expect(ControlPositionSchema.parse("top-right")).toBe("top-right");
    expect(ControlPositionSchema.parse("bottom-left")).toBe("bottom-left");
    expect(ControlPositionSchema.parse("bottom-right")).toBe("bottom-right");
  });

  it("rejects invalid positions", () => {
    expect(() => ControlPositionSchema.parse("center")).toThrow();
    expect(() => ControlPositionSchema.parse("top")).toThrow();
  });
});

describe("ControlsConfigSchema", () => {
  it("accepts boolean controls", () => {
    const config = {
      navigation: true,
      geolocate: false,
      scale: true,
    };
    expect(ControlsConfigSchema.parse(config)).toMatchObject(config);
  });

  it("accepts object controls with position", () => {
    const config = {
      navigation: {
        enabled: true,
        position: "top-left" as const,
      },
      scale: {
        enabled: true,
        position: "bottom-right" as const,
      },
    };
    expect(ControlsConfigSchema.parse(config)).toMatchObject(config);
  });

  it("accepts mixed control types", () => {
    const config = {
      navigation: true,
      scale: {
        enabled: true,
        position: "bottom-left" as const,
      },
      fullscreen: false,
    };
    expect(ControlsConfigSchema.parse(config)).toMatchObject(config);
  });

  it("accepts empty controls config", () => {
    expect(ControlsConfigSchema.parse({})).toEqual({});
  });
});

describe("LegendConfigSchema", () => {
  it("accepts minimal legend config", () => {
    const config = {};
    const result = LegendConfigSchema.parse(config);
    expect(result.position).toBe("top-left");
    expect(result.collapsed).toBe(false);
  });

  it("accepts legend with title", () => {
    const config = {
      title: "Map Legend",
    };
    const result = LegendConfigSchema.parse(config);
    expect(result.title).toBe("Map Legend");
  });

  it("accepts legend with custom position", () => {
    const config = {
      position: "bottom-right" as const,
    };
    const result = LegendConfigSchema.parse(config);
    expect(result.position).toBe("bottom-right");
  });

  it("accepts collapsed legend", () => {
    const config = {
      collapsed: true,
    };
    const result = LegendConfigSchema.parse(config);
    expect(result.collapsed).toBe(true);
  });

  it("accepts custom legend items", () => {
    const config = {
      items: [
        { color: "#ff0000", label: "High", shape: "circle" as const },
        { color: "#00ff00", label: "Low", shape: "square" as const },
      ],
    };
    expect(LegendConfigSchema.parse(config)).toMatchObject(config);
  });

  it("applies default shape to legend items", () => {
    const config = {
      items: [{ color: "#ff0000", label: "Test" }],
    };
    const result = LegendConfigSchema.parse(config);
    expect(result.items).toBeDefined();
    expect(result.items![0]!.shape).toBe("square");
  });
});

describe("MapConfigSchema", () => {
  describe("required fields", () => {
    it("accepts minimal valid config", () => {
      const config = {
        center: [-74.006, 40.7128] as [number, number],
        zoom: 12,
        mapStyle: "https://demotiles.maplibre.org/style.json",
      };
      expect(MapConfigSchema.parse(config)).toMatchObject(config);
    });

    it("requires center", () => {
      expect(() =>
        MapConfigSchema.parse({
          zoom: 12,
          mapStyle: "https://demotiles.maplibre.org/style.json",
        })
      ).toThrow();
    });

    it("requires zoom", () => {
      expect(() =>
        MapConfigSchema.parse({
          center: [0, 0],
          mapStyle: "https://demotiles.maplibre.org/style.json",
        })
      ).toThrow();
    });

    // Note: mapStyle validation is handled at runtime by MapLibre
    // The schema uses passthrough() to allow flexibility with style objects
  });

  describe("view options", () => {
    it("accepts pitch", () => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 12,
        mapStyle: "https://example.com/style.json",
        pitch: 60,
      };
      expect(MapConfigSchema.parse(config)).toMatchObject(config);
    });

    it("accepts bearing", () => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 12,
        mapStyle: "https://example.com/style.json",
        bearing: 45,
      };
      expect(MapConfigSchema.parse(config)).toMatchObject(config);
    });

    it("applies default pitch and bearing", () => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 12,
        mapStyle: "https://example.com/style.json",
      };
      const result = MapConfigSchema.parse(config);
      expect(result.pitch).toBe(0);
      expect(result.bearing).toBe(0);
    });

    it("rejects pitch out of range", () => {
      expect(() =>
        MapConfigSchema.parse({
          center: [0, 0],
          zoom: 12,
          mapStyle: "https://example.com/style.json",
          pitch: 90,
        })
      ).toThrow();
    });

    it("rejects bearing out of range", () => {
      expect(() =>
        MapConfigSchema.parse({
          center: [0, 0],
          zoom: 12,
          mapStyle: "https://example.com/style.json",
          bearing: 200,
        })
      ).toThrow();
    });
  });

  describe("constraints", () => {
    it("accepts zoom constraints", () => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 12,
        mapStyle: "https://example.com/style.json",
        minZoom: 5,
        maxZoom: 18,
      };
      expect(MapConfigSchema.parse(config)).toMatchObject(config);
    });

    it("accepts pitch constraints", () => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 12,
        mapStyle: "https://example.com/style.json",
        minPitch: 0,
        maxPitch: 60,
      };
      expect(MapConfigSchema.parse(config)).toMatchObject(config);
    });

    it("accepts maxBounds", () => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 12,
        mapStyle: "https://example.com/style.json",
        maxBounds: [-74.3, 40.5, -73.7, 40.9] as [
          number,
          number,
          number,
          number
        ],
      };
      expect(MapConfigSchema.parse(config)).toMatchObject(config);
    });
  });

  describe("interaction options", () => {
    it("accepts interactive flag", () => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 12,
        mapStyle: "https://example.com/style.json",
        interactive: false,
      };
      const result = MapConfigSchema.parse(config);
      expect(result.interactive).toBe(false);
    });

    it("applies default interactive true", () => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 12,
        mapStyle: "https://example.com/style.json",
      };
      const result = MapConfigSchema.parse(config);
      expect(result.interactive).toBe(true);
    });

    it("accepts individual interaction options", () => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 12,
        mapStyle: "https://example.com/style.json",
        scrollZoom: false,
        dragRotate: true,
        doubleClickZoom: false,
      };
      expect(MapConfigSchema.parse(config)).toMatchObject(config);
    });
  });

  describe("style object", () => {
    it("accepts style object instead of URL", () => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 12,
        mapStyle: {
          version: 8,
          sources: {},
          layers: [],
        },
      };
      expect(MapConfigSchema.parse(config)).toMatchObject(config);
    });
  });

  describe("passthrough", () => {
    it("accepts additional MapLibre options", () => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 12,
        mapStyle: "https://example.com/style.json",
        fadeDuration: 300,
        antialias: true,
        maxTileCacheSize: 100,
      };
      expect(MapConfigSchema.parse(config)).toMatchObject(config);
    });
  });
});

describe("MapBlockSchema", () => {
  it("accepts minimal map block", () => {
    const block = {
      type: "map" as const,
      id: "main-map",
      config: {
        center: [-74.006, 40.7128] as [number, number],
        zoom: 12,
        mapStyle: "https://demotiles.maplibre.org/style.json",
      },
    };
    const result = MapBlockSchema.parse(block);
    expect(result.type).toBe("map");
    expect(result.id).toBe("main-map");
    expect(result.layers).toEqual([]);
  });

  it("accepts map block with layers", () => {
    const block = {
      type: "map" as const,
      id: "map-with-layers",
      config: {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      },
      layers: [
        {
          id: "points",
          type: "circle" as const,
          source: {
            type: "geojson" as const,
            data: { type: "FeatureCollection", features: [] },
          },
          paint: {
            "circle-radius": 8,
            "circle-color": "#ff0000",
          },
        },
      ],
    };
    expect(MapBlockSchema.parse(block)).toMatchObject(block);
  });

  it("accepts map block with layer references", () => {
    const block = {
      type: "map" as const,
      id: "map-with-refs",
      config: {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      },
      layers: [{ $ref: "#/layers/bikeLayer" }, { $ref: "#/layers/parkLayer" }],
    };
    expect(MapBlockSchema.parse(block)).toMatchObject(block);
  });

  it("accepts map block with controls", () => {
    const block = {
      type: "map" as const,
      id: "controlled-map",
      config: {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      },
      controls: {
        navigation: true,
        scale: true,
      },
    };
    expect(MapBlockSchema.parse(block)).toMatchObject(block);
  });

  it("accepts map block with legend", () => {
    const block = {
      type: "map" as const,
      id: "map-with-legend",
      config: {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      },
      legend: {
        title: "Map Legend",
        position: "top-left" as const,
      },
    };
    expect(MapBlockSchema.parse(block)).toMatchObject(block);
  });

  it("accepts map block with styling", () => {
    const block = {
      type: "map" as const,
      id: "styled-map",
      className: "map-container",
      style: "height: 500px; border: 1px solid #ccc;",
      config: {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      },
    };
    expect(MapBlockSchema.parse(block)).toMatchObject(block);
  });

  it('requires type to be "map"', () => {
    expect(() =>
      MapBlockSchema.parse({
        type: "invalid",
        id: "test",
        config: {
          center: [0, 0],
          zoom: 2,
          mapStyle: "https://example.com/style.json",
        },
      })
    ).toThrow();
  });

  it("requires id", () => {
    expect(() =>
      MapBlockSchema.parse({
        type: "map",
        config: {
          center: [0, 0],
          zoom: 2,
          mapStyle: "https://example.com/style.json",
        },
      })
    ).toThrow();
  });

  it("requires config", () => {
    expect(() =>
      MapBlockSchema.parse({
        type: "map",
        id: "test",
      })
    ).toThrow();
  });
});

describe("MapFullPageBlockSchema", () => {
  it("accepts minimal full-page map block", () => {
    const block = {
      type: "map-fullpage" as const,
      id: "fullpage-map",
      config: {
        center: [-122.4194, 37.7749] as [number, number],
        zoom: 13,
        mapStyle: "https://demotiles.maplibre.org/style.json",
      },
    };
    const result = MapFullPageBlockSchema.parse(block);
    expect(result.type).toBe("map-fullpage");
    expect(result.id).toBe("fullpage-map");
  });

  it("accepts full-page map with 3D config", () => {
    const block = {
      type: "map-fullpage" as const,
      id: "3d-map",
      config: {
        center: [0, 0] as [number, number],
        zoom: 15,
        pitch: 60,
        bearing: 30,
        mapStyle: "https://example.com/style.json",
      },
    };
    expect(MapFullPageBlockSchema.parse(block)).toMatchObject(block);
  });

  it("accepts full-page map with all features", () => {
    const block = {
      type: "map-fullpage" as const,
      id: "complete-map",
      className: "fullscreen-map",
      style: "z-index: 1;",
      config: {
        center: [0, 0] as [number, number],
        zoom: 12,
        mapStyle: "https://example.com/style.json",
      },
      layers: [{ $ref: "#/layers/buildings" }],
      controls: {
        navigation: true,
        fullscreen: true,
      },
      legend: {
        title: "Features",
      },
    };
    expect(MapFullPageBlockSchema.parse(block)).toMatchObject(block);
  });

  it('requires type to be "map-fullpage"', () => {
    expect(() =>
      MapFullPageBlockSchema.parse({
        type: "map",
        id: "test",
        config: {
          center: [0, 0],
          zoom: 2,
          mapStyle: "https://example.com/style.json",
        },
      })
    ).toThrow();
  });
});
