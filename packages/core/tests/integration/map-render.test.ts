import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { JSDOM } from "jsdom";
import * as fs from "fs";
import * as path from "path";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { MapRenderer } from "../../src/renderer/map-renderer";

// Mock maplibre-gl before imports
vi.mock("maplibre-gl", () => ({
  default: {
    Map: vi.fn().mockImplementation((options) => {
      const events = new Map<string, Set<Function>>();
      const sources = new Map<string, any>();
      const layers = new Map<string, any>();

      const map = {
        options,
        on(event: string, callback: Function) {
          if (!events.has(event)) {
            events.set(event, new Set());
          }
          events.get(event)!.add(callback);
          // Auto-trigger load event
          if (event === "load") {
            setTimeout(() => callback(), 0);
          }
        },
        off(event: string, callback: Function) {
          events.get(event)?.delete(callback);
        },
        addSource(id: string, source: any) {
          sources.set(id, source);
        },
        getSource(id: string) {
          return sources.get(id);
        },
        addLayer(layer: any) {
          layers.set(layer.id, layer);
        },
        getLayer(id: string) {
          return layers.get(id);
        },
        removeLayer(id: string) {
          layers.delete(id);
        },
        removeSource(id: string) {
          sources.delete(id);
        },
        remove() {
          events.clear();
          sources.clear();
          layers.clear();
        },
        getCanvas() {
          return { style: { cursor: "" } };
        },
        addControl: vi.fn(),
        removeControl: vi.fn(),
      };

      return map;
    }),
    NavigationControl: vi.fn(),
    GeolocateControl: vi.fn(),
    ScaleControl: vi.fn(),
    FullscreenControl: vi.fn(),
    Popup: vi.fn(() => ({
      setLngLat: vi.fn().mockReturnThis(),
      setHTML: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn(),
    })),
  },
}));

/**
 * Integration tests for map rendering from YAML configs
 *
 * These tests verify end-to-end functionality:
 * - YAML parsing
 * - Config validation
 * - Map renderer initialization
 * - Layer management
 */
describe("Map Rendering Integration", () => {
  let dom: JSDOM;
  let document: Document;
  let window: Window;
  let container: HTMLDivElement;

  beforeEach(() => {
    // Create a fresh DOM for each test
    dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
      url: "http://localhost",
    });
    document = dom.window.document;
    window = dom.window as any;

    // Set up global document and window
    global.document = document;
    global.window = window as any;
    global.HTMLElement = window.HTMLElement;

    // Create container for maps
    container = document.createElement("div");
    container.style.width = "800px";
    container.style.height = "600px";
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container.parentNode) {
      document.body.removeChild(container);
    }
    dom.window.close();
  });

  describe("Basic Map Rendering", () => {
    it("renders a basic map from YAML config", async () => {
      const yaml = `
pages:
  - id: test
    path: "/"
    title: "Test"
    blocks:
      - type: map
        id: test-map
        config:
          center: [-74.006, 40.7128]
          zoom: 12
          mapStyle: "https://demotiles.maplibre.org/style.json"
        layers: []
`;

      const config = YAMLParser.parse(yaml);
      const mapBlock = config.pages[0].blocks[0];

      expect(mapBlock.type).toBe("map");
      expect(mapBlock.id).toBe("test-map");

      const renderer = new MapRenderer(
        container,
        mapBlock.config,
        mapBlock.layers || []
      );

      // Wait for load
      await new Promise((resolve) => renderer.on("load", resolve));

      expect(renderer.getMap()).toBeDefined();

      renderer.destroy();
    });

    it("loads map from simple-map.yaml fixture", async () => {
      const yamlPath = path.join(__dirname, "../fixtures/simple-map.yaml");
      const yaml = fs.readFileSync(yamlPath, "utf-8");

      const config = YAMLParser.parse(yaml);
      const mapBlock = config.pages[0].blocks[0];

      expect(mapBlock.type).toBe("map");
      expect(mapBlock.layers).toHaveLength(1);
      expect(mapBlock.layers![0].id).toBe("points");

      const renderer = new MapRenderer(
        container,
        mapBlock.config,
        mapBlock.layers || []
      );

      await new Promise((resolve) => renderer.on("load", resolve));

      const map = renderer.getMap();
      expect(map).toBeDefined();

      renderer.destroy();
    });
  });

  describe("Layer Management", () => {
    it("adds layers with GeoJSON data", async () => {
      const config = {
        center: [-74.006, 40.7128] as [number, number],
        zoom: 12,
        mapStyle: "https://demotiles.maplibre.org/style.json",
      };

      const layers = [
        {
          id: "test-layer",
          type: "circle" as const,
          visible: true,
          toggleable: false,
          source: {
            type: "geojson" as const,
            data: {
              type: "FeatureCollection" as const,
              features: [
                {
                  type: "Feature" as const,
                  geometry: { type: "Point" as const, coordinates: [-74.006, 40.7128] },
                  properties: { name: "Test" },
                },
              ],
            },
          },
          paint: {
            "circle-radius": 10,
            "circle-color": "#ff0000",
          },
        },
      ];

      const renderer = new MapRenderer(container, config, layers);

      await new Promise((resolve) => renderer.on("load", resolve));

      const map = renderer.getMap()!;
      expect(map.getLayer("test-layer")).toBeDefined();

      renderer.destroy();
    });

    it("handles multiple layers", async () => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 1,
        mapStyle: "https://demotiles.maplibre.org/style.json",
      };

      const layers = [
        {
          id: "layer-1",
          type: "circle" as const,
          visible: true,
          toggleable: false,
          source: {
            type: "geojson" as const,
            data: { type: "FeatureCollection" as const, features: [] },
          },
        },
        {
          id: "layer-2",
          type: "line" as const,
          visible: true,
          toggleable: false,
          source: {
            type: "geojson" as const,
            data: { type: "FeatureCollection" as const, features: [] },
          },
        },
      ];

      const renderer = new MapRenderer(container, config, layers);

      await new Promise((resolve) => renderer.on("load", resolve));

      const map = renderer.getMap()!;
      expect(map.getLayer("layer-1")).toBeDefined();
      expect(map.getLayer("layer-2")).toBeDefined();

      renderer.destroy();
    });
  });

  describe("Reference Resolution", () => {
    it("resolves layer references from global layers", () => {
      const yamlPath = path.join(__dirname, "../fixtures/global-layers.yaml");
      const yaml = fs.readFileSync(yamlPath, "utf-8");

      const config = YAMLParser.parse(yaml);
      const mapBlock = config.pages[0].blocks[0];

      expect(mapBlock.layers).toHaveLength(2);
      expect(mapBlock.layers![0]).toHaveProperty("id", "bikes");
      expect(mapBlock.layers![0]).toHaveProperty("paint");
      expect(mapBlock.layers![1]).toHaveProperty("id", "parks");
      expect(mapBlock.layers![1]).toHaveProperty("paint");
    });

    it("resolves references correctly", () => {
      const yaml = `
layers:
  sharedLayer:
    id: shared
    type: circle
    visible: true
    toggleable: false
    source:
      type: geojson
      data:
        type: FeatureCollection
        features: []
    paint:
      circle-color: "#ff0000"

pages:
  - id: test
    path: "/"
    title: "Test"
    blocks:
      - type: map
        id: test
        config:
          center: [0, 0]
          zoom: 1
          mapStyle: "https://demotiles.maplibre.org/style.json"
        layers:
          - $ref: "#/layers/sharedLayer"
`;

      const config = YAMLParser.parse(yaml);
      const mapBlock = config.pages[0].blocks[0];

      expect(mapBlock.layers).toHaveLength(1);
      expect(mapBlock.layers![0]).toHaveProperty("id", "shared");
      expect(mapBlock.layers![0]).toHaveProperty("paint");
      expect(mapBlock.layers![0].paint).toHaveProperty("circle-color", "#ff0000");
    });
  });

  describe("Config Validation", () => {
    it("validates correct config", () => {
      const yaml = `
pages:
  - id: test
    path: "/"
    title: "Test"
    blocks:
      - type: map
        id: test-map
        config:
          center: [-74.006, 40.7128]
          zoom: 12
          mapStyle: "https://demotiles.maplibre.org/style.json"
        layers: []
`;

      expect(() => YAMLParser.parse(yaml)).not.toThrow();
    });

    it("throws on invalid config", () => {
      const yaml = `
pages:
  - id: test
    path: "/"
    title: "Test"
    blocks:
      - type: map
        id: test-map
        config:
          center: "invalid"
          zoom: 12
          mapStyle: "https://demotiles.maplibre.org/style.json"
        layers: []
`;

      expect(() => YAMLParser.parse(yaml)).toThrow();
    });

    it("validates layer config", () => {
      const yaml = `
pages:
  - id: test
    path: "/"
    title: "Test"
    blocks:
      - type: map
        id: test-map
        config:
          center: [0, 0]
          zoom: 1
          mapStyle: "https://demotiles.maplibre.org/style.json"
        layers:
          - id: test
            type: circle
            visible: true
            toggleable: false
            source:
              type: geojson
              data:
                type: FeatureCollection
                features: []
`;

      expect(() => YAMLParser.parse(yaml)).not.toThrow();
    });
  });

  describe("Event System", () => {
    it("emits load event", async () => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 1,
        mapStyle: "https://demotiles.maplibre.org/style.json",
      };

      const renderer = new MapRenderer(container, config, []);

      let loadCalled = false;
      renderer.on("load", () => {
        loadCalled = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(loadCalled).toBe(true);

      renderer.destroy();
    });

    it("emits layer:added event", async () => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 1,
        mapStyle: "https://demotiles.maplibre.org/style.json",
      };

      const renderer = new MapRenderer(container, config, []);

      await new Promise((resolve) => renderer.on("load", resolve));

      let eventData: any;
      renderer.on("layer:added", (data) => {
        eventData = data;
      });

      await renderer.addLayer({
        id: "new-layer",
        type: "circle" as const,
        visible: true,
        toggleable: false,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
        },
      });

      expect(eventData).toBeDefined();
      expect(eventData.layerId).toBe("new-layer");

      renderer.destroy();
    });
  });
});
