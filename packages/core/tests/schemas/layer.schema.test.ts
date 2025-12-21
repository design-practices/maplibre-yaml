/**
 * @file Tests for layer schemas
 * @module @maplibre-yaml/core/tests/schemas/layer
 */

import { describe, it, expect } from "vitest";
import {
  PopupContentItemSchema,
  PopupContentSchema,
  InteractiveConfigSchema,
  LegendItemSchema,
  CircleLayerSchema,
  LineLayerSchema,
  FillLayerSchema,
  SymbolLayerSchema,
  RasterLayerSchema,
  FillExtrusionLayerSchema,
  HeatmapLayerSchema,
  HillshadeLayerSchema,
  BackgroundLayerSchema,
  LayerSchema,
  LayerReferenceSchema,
  LayerOrReferenceSchema,
} from "../../src/schemas/layer.schema";

describe("PopupContentItemSchema", () => {
  it("accepts static string", () => {
    const item = { str: "Hello World" };
    expect(PopupContentItemSchema.parse(item)).toMatchObject(item);
  });

  it("accepts property reference", () => {
    const item = { property: "name", else: "Unknown" };
    expect(PopupContentItemSchema.parse(item)).toMatchObject(item);
  });

  it("accepts formatted number", () => {
    const item = { property: "population", format: ",.0f" };
    expect(PopupContentItemSchema.parse(item)).toMatchObject(item);
  });

  it("accepts link", () => {
    const item = { href: "https://example.com", text: "Learn more" };
    expect(PopupContentItemSchema.parse(item)).toMatchObject(item);
  });

  it("accepts image", () => {
    const item = { src: "https://example.com/image.jpg", alt: "Description" };
    expect(PopupContentItemSchema.parse(item)).toMatchObject(item);
  });
});

describe("PopupContentSchema", () => {
  it("accepts popup content structure", () => {
    const content = [
      { h3: [{ property: "name" }] },
      {
        p: [
          { str: "Population: " },
          { property: "population", format: ",.0f" },
        ],
      },
    ];
    expect(PopupContentSchema.parse(content)).toEqual(content);
  });

  it("accepts mixed content types", () => {
    const content = [
      { h1: [{ str: "Title" }] },
      { p: [{ str: "Text" }] },
      { a: [{ href: "https://example.com", text: "Link" }] },
      { img: [{ src: "https://example.com/img.jpg", alt: "Image" }] },
    ];
    expect(PopupContentSchema.parse(content)).toEqual(content);
  });
});

describe("InteractiveConfigSchema", () => {
  it("accepts hover configuration", () => {
    const config = {
      hover: {
        cursor: "pointer",
        highlight: true,
      },
    };
    expect(InteractiveConfigSchema.parse(config)).toMatchObject(config);
  });

  it("accepts click with popup", () => {
    const config = {
      click: {
        popup: [{ h3: [{ property: "name" }] }],
      },
    };
    expect(InteractiveConfigSchema.parse(config)).toMatchObject(config);
  });

  it("accepts click with flyTo", () => {
    const config = {
      click: {
        flyTo: {
          zoom: 15,
          duration: 1000,
        },
      },
    };
    expect(InteractiveConfigSchema.parse(config)).toMatchObject(config);
  });

  it("accepts custom actions", () => {
    const config = {
      mouseenter: { action: "highlight" },
      mouseleave: { action: "unhighlight" },
    };
    expect(InteractiveConfigSchema.parse(config)).toMatchObject(config);
  });
});

describe("LegendItemSchema", () => {
  it("accepts basic legend item", () => {
    const item = {
      color: "#ff0000",
      label: "Earthquakes",
    };
    const result = LegendItemSchema.parse(item);
    expect(result.color).toBe("#ff0000");
    expect(result.label).toBe("Earthquakes");
    expect(result.shape).toBe("square"); // default
  });

  it("accepts all shape types", () => {
    expect(
      LegendItemSchema.parse({ color: "#f00", label: "Test", shape: "circle" })
    ).toBeDefined();
    expect(
      LegendItemSchema.parse({ color: "#f00", label: "Test", shape: "square" })
    ).toBeDefined();
    expect(
      LegendItemSchema.parse({ color: "#f00", label: "Test", shape: "line" })
    ).toBeDefined();
    expect(
      LegendItemSchema.parse({ color: "#f00", label: "Test", shape: "icon" })
    ).toBeDefined();
  });

  it("accepts icon with custom icon", () => {
    const item = {
      color: "#00ff00",
      label: "Markers",
      shape: "icon" as const,
      icon: "marker-15",
    };
    expect(LegendItemSchema.parse(item)).toMatchObject(item);
  });
});

describe("CircleLayerSchema", () => {
  it("accepts basic circle layer", () => {
    const layer = {
      id: "points",
      type: "circle" as const,
      source: {
        type: "geojson" as const,
        url: "https://example.com/points.geojson",
      },
      paint: {
        "circle-radius": 8,
        "circle-color": "#ff0000",
      },
    };
    expect(CircleLayerSchema.parse(layer)).toMatchObject(layer);
  });

  it("accepts expression-based styling", () => {
    const layer = {
      id: "points",
      type: "circle" as const,
      source: {
        type: "geojson" as const,
        data: { type: "FeatureCollection", features: [] },
      },
      paint: {
        "circle-radius": ["get", "size"],
        "circle-color": ["get", "color"],
      },
    };
    expect(CircleLayerSchema.parse(layer)).toMatchObject(layer);
  });

  it("applies default visibility", () => {
    const layer = {
      id: "points",
      type: "circle" as const,
      source: {
        type: "geojson" as const,
        data: { type: "FeatureCollection", features: [] },
      },
    };
    const result = CircleLayerSchema.parse(layer);
    expect(result.visible).toBe(true);
    expect(result.toggleable).toBe(true);
  });

  it("accepts interactive configuration", () => {
    const layer = {
      id: "points",
      type: "circle" as const,
      source: {
        type: "geojson" as const,
        data: { type: "FeatureCollection", features: [] },
      },
      interactive: {
        hover: { cursor: "pointer" },
        click: { popup: [{ h3: [{ property: "name" }] }] },
      },
    };
    expect(CircleLayerSchema.parse(layer)).toMatchObject(layer);
  });

  it("accepts legend configuration", () => {
    const layer = {
      id: "points",
      type: "circle" as const,
      source: {
        type: "geojson" as const,
        data: { type: "FeatureCollection", features: [] },
      },
      legend: {
        color: "#ff0000",
        label: "Points",
        shape: "circle" as const,
      },
    };
    expect(CircleLayerSchema.parse(layer)).toMatchObject(layer);
  });
});

describe("LineLayerSchema", () => {
  it("accepts basic line layer", () => {
    const layer = {
      id: "roads",
      type: "line" as const,
      source: {
        type: "geojson" as const,
        url: "https://example.com/roads.geojson",
      },
      paint: {
        "line-color": "#333333",
        "line-width": 2,
      },
    };
    expect(LineLayerSchema.parse(layer)).toMatchObject(layer);
  });

  it("accepts dashed line", () => {
    const layer = {
      id: "roads",
      type: "line" as const,
      source: {
        type: "geojson" as const,
        data: { type: "FeatureCollection", features: [] },
      },
      paint: {
        "line-dasharray": [2, 1],
      },
    };
    expect(LineLayerSchema.parse(layer)).toMatchObject(layer);
  });

  it("accepts layout properties", () => {
    const layer = {
      id: "roads",
      type: "line" as const,
      source: {
        type: "geojson" as const,
        data: { type: "FeatureCollection", features: [] },
      },
      layout: {
        "line-cap": "round" as const,
        "line-join": "round" as const,
      },
    };
    expect(LineLayerSchema.parse(layer)).toMatchObject(layer);
  });
});

describe("FillLayerSchema", () => {
  it("accepts basic fill layer", () => {
    const layer = {
      id: "parks",
      type: "fill" as const,
      source: {
        type: "geojson" as const,
        url: "https://example.com/parks.geojson",
      },
      paint: {
        "fill-color": "#228B22",
        "fill-opacity": 0.5,
        "fill-outline-color": "#006400",
      },
    };
    expect(FillLayerSchema.parse(layer)).toMatchObject(layer);
  });
});

describe("SymbolLayerSchema", () => {
  it("accepts icon layer", () => {
    const layer = {
      id: "markers",
      type: "symbol" as const,
      source: {
        type: "geojson" as const,
        data: { type: "FeatureCollection", features: [] },
      },
      layout: {
        "icon-image": "marker-15",
        "icon-size": 1.5,
      },
    };
    expect(SymbolLayerSchema.parse(layer)).toMatchObject(layer);
  });

  it("accepts text layer", () => {
    const layer = {
      id: "labels",
      type: "symbol" as const,
      source: {
        type: "geojson" as const,
        data: { type: "FeatureCollection", features: [] },
      },
      layout: {
        "text-field": ["get", "name"],
        "text-size": 12,
        "text-anchor": "top" as const,
      },
      paint: {
        "text-color": "#000000",
        "text-halo-color": "#ffffff",
        "text-halo-width": 2,
      },
    };
    expect(SymbolLayerSchema.parse(layer)).toMatchObject(layer);
  });

  it("accepts icon and text combined", () => {
    const layer = {
      id: "poi",
      type: "symbol" as const,
      source: {
        type: "geojson" as const,
        data: { type: "FeatureCollection", features: [] },
      },
      layout: {
        "icon-image": "poi",
        "text-field": ["get", "name"],
      },
    };
    expect(SymbolLayerSchema.parse(layer)).toMatchObject(layer);
  });
});

describe("RasterLayerSchema", () => {
  it("accepts basic raster layer", () => {
    const layer = {
      id: "satellite",
      type: "raster" as const,
      source: {
        type: "raster" as const,
        tiles: ["https://tile.example.com/{z}/{x}/{y}.png"],
      },
      paint: {
        "raster-opacity": 0.8,
      },
    };
    expect(RasterLayerSchema.parse(layer)).toMatchObject(layer);
  });
});

describe("FillExtrusionLayerSchema", () => {
  it("accepts 3D buildings layer", () => {
    const layer = {
      id: "buildings",
      type: "fill-extrusion" as const,
      source: {
        type: "vector" as const,
        url: "https://example.com/buildings.json",
      },
      "source-layer": "buildings",
      paint: {
        "fill-extrusion-color": "#aaaaaa",
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-base": ["get", "min_height"],
        "fill-extrusion-opacity": 0.8,
      },
    };
    expect(FillExtrusionLayerSchema.parse(layer)).toMatchObject(layer);
  });
});

describe("HeatmapLayerSchema", () => {
  it("accepts heatmap layer", () => {
    const layer = {
      id: "earthquakes-heat",
      type: "heatmap" as const,
      source: {
        type: "geojson" as const,
        url: "https://example.com/earthquakes.geojson",
      },
      paint: {
        "heatmap-intensity": 1,
        "heatmap-radius": 20,
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(0,0,255,0)",
          0.5,
          "yellow",
          1,
          "red",
        ],
      },
    };
    expect(HeatmapLayerSchema.parse(layer)).toMatchObject(layer);
  });
});

describe("HillshadeLayerSchema", () => {
  it("accepts hillshade layer", () => {
    const layer = {
      id: "hillshade",
      type: "hillshade" as const,
      source: "terrain-source",
      paint: {
        "hillshade-illumination-direction": 315,
        "hillshade-exaggeration": 0.5,
      },
    };
    expect(HillshadeLayerSchema.parse(layer)).toMatchObject(layer);
  });
});

describe("BackgroundLayerSchema", () => {
  it("accepts background layer", () => {
    const layer = {
      id: "background",
      type: "background" as const,
      paint: {
        "background-color": "#f0f0f0",
      },
    };
    expect(BackgroundLayerSchema.parse(layer)).toMatchObject(layer);
  });
});

describe("LayerSchema", () => {
  it("accepts all layer types", () => {
    const layers = [
      {
        id: "circle",
        type: "circle" as const,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection", features: [] },
        },
      },
      {
        id: "line",
        type: "line" as const,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection", features: [] },
        },
      },
      {
        id: "fill",
        type: "fill" as const,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection", features: [] },
        },
      },
      {
        id: "symbol",
        type: "symbol" as const,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection", features: [] },
        },
      },
      { id: "raster", type: "raster" as const, source: "raster-source" },
      {
        id: "fill-extrusion",
        type: "fill-extrusion" as const,
        source: "vector-source",
      },
      {
        id: "heatmap",
        type: "heatmap" as const,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection", features: [] },
        },
      },
      { id: "hillshade", type: "hillshade" as const, source: "dem-source" },
      { id: "background", type: "background" as const },
    ];

    layers.forEach((layer) => {
      expect(() => LayerSchema.parse(layer)).not.toThrow();
    });
  });

  it("rejects invalid layer type", () => {
    expect(() =>
      LayerSchema.parse({
        id: "invalid",
        type: "invalid-type",
        source: { type: "geojson", data: {} },
      })
    ).toThrow();
  });
});

describe("LayerReferenceSchema", () => {
  it("accepts layer reference", () => {
    const ref = { $ref: "#/layers/bikeLayer" };
    expect(LayerReferenceSchema.parse(ref)).toEqual(ref);
  });

  it("rejects missing $ref", () => {
    expect(() => LayerReferenceSchema.parse({})).toThrow();
  });
});

describe("LayerOrReferenceSchema", () => {
  it("accepts inline layer", () => {
    const layer = {
      id: "inline",
      type: "circle" as const,
      source: {
        type: "geojson" as const,
        data: { type: "FeatureCollection", features: [] },
      },
    };
    expect(LayerOrReferenceSchema.parse(layer)).toMatchObject(layer);
  });

  it("accepts layer reference", () => {
    const ref = { $ref: "#/layers/sharedLayer" };
    expect(LayerOrReferenceSchema.parse(ref)).toEqual(ref);
  });
});

describe("Layer zoom and filter", () => {
  it("accepts minzoom and maxzoom", () => {
    const layer = {
      id: "filtered",
      type: "circle" as const,
      source: {
        type: "geojson" as const,
        data: { type: "FeatureCollection", features: [] },
      },
      minzoom: 5,
      maxzoom: 15,
    };
    expect(CircleLayerSchema.parse(layer)).toMatchObject(layer);
  });

  it("accepts filter expression", () => {
    const layer = {
      id: "filtered",
      type: "circle" as const,
      source: {
        type: "geojson" as const,
        data: { type: "FeatureCollection", features: [] },
      },
      filter: ["==", ["get", "type"], "hospital"],
    };
    expect(CircleLayerSchema.parse(layer)).toMatchObject(layer);
  });

  it("accepts before property", () => {
    const layer = {
      id: "below",
      type: "circle" as const,
      source: {
        type: "geojson" as const,
        data: { type: "FeatureCollection", features: [] },
      },
      before: "other-layer",
    };
    expect(CircleLayerSchema.parse(layer)).toMatchObject(layer);
  });
});
