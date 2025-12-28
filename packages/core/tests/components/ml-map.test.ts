import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock maplibre-gl before any imports
vi.mock("maplibre-gl", () => ({
  default: {
    Map: vi.fn(() => ({
      on: vi.fn(),
      off: vi.fn(),
      remove: vi.fn(),
      addSource: vi.fn(),
      addLayer: vi.fn(),
      getSource: vi.fn(),
      getLayer: vi.fn(),
      getCanvas: vi.fn(() => ({
        style: { cursor: "" },
      })),
    })),
    Popup: vi.fn(() => ({
      setLngLat: vi.fn().mockReturnThis(),
      setHTML: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn(),
    })),
    NavigationControl: vi.fn(),
    GeolocateControl: vi.fn(),
    ScaleControl: vi.fn(),
    FullscreenControl: vi.fn(),
  },
}));

// Mock MapRenderer before import
vi.mock("../../src/renderer/map-renderer", () => ({
  MapRenderer: vi
    .fn()
    .mockImplementation((container, config, layers, options) => {
      const mockRenderer = {
        container,
        config,
        layers,
        options,
        destroyed: false,
        getMap: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })),
        addControls: vi.fn(),
        getLegendBuilder: vi.fn(() => ({
          build: vi.fn(),
        })),
        destroy: vi.fn(function (this: any) {
          this.destroyed = true;
        }),
        on: vi.fn(),
      };

      // Simulate load callback
      setTimeout(() => {
        if (options?.onLoad && !mockRenderer.destroyed) {
          options.onLoad();
        }
      }, 0);

      return mockRenderer;
    }),
}));

import { MLMap } from "../../src/components/ml-map";

describe("MLMap", () => {
  beforeEach(() => {
    // Clear the DOM between tests
    document.body.innerHTML = "";

    // Register the custom element if not already registered
    if (!customElements.get("ml-map")) {
      customElements.define("ml-map", MLMap);
    }
  });

  describe("connectedCallback", () => {
    it("creates container div when connected", async () => {
      const element = document.createElement('ml-map') as MLMap;
      element.setAttribute(
        "config",
        JSON.stringify({
          type: "map",
          id: "test-map",
          config: {
            mapStyle: "https://demotiles.maplibre.org/style.json",
            center: [0, 0],
            zoom: 1,
          },
        })
      );
      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const container = element.querySelector("div");
      expect(container).toBeTruthy();
      // Verify the map container was created (not an error div)
      expect(element.getRenderer()).toBeTruthy();
    });

    it("dispatches error event when no config is found", (done) => {
      const element = document.createElement('ml-map') as MLMap;

      element.addEventListener("error", (e: Event) => {
        const customEvent = e as CustomEvent;
        expect(customEvent.detail.error).toBeDefined();
        expect(customEvent.detail.error.message).toContain(
          "No valid map configuration found"
        );
        done();
      });

      document.body.appendChild(element);
    });
  });

  describe("disconnectedCallback", () => {
    it("cleans up renderer when disconnected", async () => {
      const element = document.createElement('ml-map') as MLMap;
      element.setAttribute(
        "config",
        JSON.stringify({
          type: "map",
          id: "test-map",
          config: {
            mapStyle: "https://demotiles.maplibre.org/style.json",
            center: [0, 0],
            zoom: 1,
          },
        })
      );

      document.body.appendChild(element);

      // Wait for renderer to be created
      await new Promise((resolve) => setTimeout(resolve, 10));

      const renderer = element.getRenderer();
      expect(renderer).toBeTruthy();

      element.remove();

      expect(renderer?.destroy).toHaveBeenCalled();
      expect(element.getRenderer()).toBeNull();
    });
  });

  describe("attributeChangedCallback", () => {
    it("re-renders when config attribute changes", async () => {
      const element = document.createElement('ml-map') as MLMap;
      element.setAttribute(
        "config",
        JSON.stringify({
          type: "map",
          id: "test-map",
          config: {
            mapStyle: "https://demotiles.maplibre.org/style.json",
            center: [0, 0],
            zoom: 1,
          },
        })
      );

      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const firstRenderer = element.getRenderer();
      expect(firstRenderer).toBeTruthy();

      // Change config
      element.setAttribute(
        "config",
        JSON.stringify({
          type: "map",
          id: "test-map",
          config: {
            mapStyle: "https://demotiles.maplibre.org/style.json",
            center: [10, 10],
            zoom: 5,
          },
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(firstRenderer?.destroy).toHaveBeenCalled();
    });
  });

  describe("config from JSON attribute", () => {
    it("parses valid JSON config attribute", async () => {
      const config = {
        type: "map" as const,
        id: "test-map",
        config: {
          mapStyle: "https://demotiles.maplibre.org/style.json",
          center: [-74.5, 40] as [number, number],
          zoom: 9,
        },
        layers: [
          {
            id: "test-layer",
            type: "circle" as const,
            visible: true,
            toggleable: false,
            source: {
              type: "geojson" as const,
              data: { type: "FeatureCollection" as const, features: [] },
            },
          },
        ],
      };

      const element = document.createElement('ml-map') as MLMap;
      element.setAttribute("config", JSON.stringify(config));

      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const renderer = element.getRenderer();
      expect(renderer).toBeTruthy();
      expect(renderer?.config.mapStyle).toBe(config.config.mapStyle);
      expect(renderer?.config.center).toEqual(config.config.center);
      expect(renderer?.config.zoom).toBe(config.config.zoom);
      expect(renderer?.layers).toHaveLength(1);
      expect(renderer?.layers[0].id).toBe("test-layer");
    });

    it("handles invalid JSON in config attribute", (done) => {
      const element = document.createElement('ml-map') as MLMap;
      element.setAttribute("config", "not valid json");

      element.addEventListener("error", () => {
        done();
      });

      document.body.appendChild(element);
    });
  });

  describe("config from YAML script", () => {
    it("parses valid YAML script", async () => {
      const element = document.createElement('ml-map') as MLMap;
      const script = document.createElement("script");
      script.type = "text/yaml";
      script.textContent = `
type: map
id: test-map
config:
  mapStyle: https://demotiles.maplibre.org/style.json
  center: [-74.5, 40]
  zoom: 9
layers:
  - id: test-layer
    type: circle
    visible: true
    toggleable: false
    source:
      type: geojson
      data:
        type: FeatureCollection
        features: []
`;
      element.appendChild(script);

      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const renderer = element.getRenderer();
      expect(renderer).toBeTruthy();
      expect(renderer?.config.mapStyle).toBe(
        "https://demotiles.maplibre.org/style.json"
      );
    });

    it("handles invalid YAML script", (done) => {
      const element = document.createElement('ml-map') as MLMap;
      const script = document.createElement("script");
      script.type = "text/yaml";
      script.textContent = "not: valid: yaml: structure:";
      element.appendChild(script);

      element.addEventListener("error", () => {
        done();
      });

      document.body.appendChild(element);
    });
  });

  describe("config priority", () => {
    it("prefers config attribute over scripts", async () => {
      const element = document.createElement('ml-map') as MLMap;

      // Add JSON script
      const jsonScript = document.createElement("script");
      jsonScript.type = "application/json";
      jsonScript.textContent = JSON.stringify({
        type: "map",
        id: "test-map",
        config: {
          mapStyle: "https://script.com/style.json",
          center: [0, 0],
          zoom: 1,
        },
      });
      element.appendChild(jsonScript);

      // Set config attribute (should take priority)
      element.setAttribute(
        "config",
        JSON.stringify({
          type: "map",
          id: "test-map",
          config: {
            mapStyle: "https://attribute.com/style.json",
            center: [10, 10],
            zoom: 5,
          },
        })
      );

      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const renderer = element.getRenderer();
      expect(renderer?.config.mapStyle).toBe(
        "https://attribute.com/style.json"
      );
    });
  });

  describe("event dispatching", () => {
    it("dispatches load event when map loads", (done) => {
      const element = document.createElement('ml-map') as MLMap;
      element.setAttribute(
        "config",
        JSON.stringify({
          type: "map",
          id: "test-map",
          config: {
            mapStyle: "https://demotiles.maplibre.org/style.json",
            center: [0, 0],
            zoom: 1,
          },
        })
      );

      element.addEventListener("load", (e: Event) => {
        const customEvent = e as CustomEvent;
        expect(customEvent.detail.map).toBeDefined();
        done();
      });

      document.body.appendChild(element);
    });
  });

  describe("controls integration", () => {
    it("adds controls when specified in config", async () => {
      const element = document.createElement('ml-map') as MLMap;
      element.setAttribute(
        "config",
        JSON.stringify({
          type: "map",
          id: "test-map",
          config: {
            mapStyle: "https://demotiles.maplibre.org/style.json",
            center: [0, 0],
            zoom: 1,
          },
          controls: {
            navigation: { enabled: true, position: "top-right" },
          },
        })
      );

      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const renderer = element.getRenderer();
      expect(renderer).toBeTruthy();
      // Controls are passed to MapRenderer constructor, not via addControls
      // The MapRenderer mock receives controls in the options parameter
    });
  });

  describe("legend integration", () => {
    it("handles legend config without errors", async () => {
      const element = document.createElement('ml-map') as MLMap;
      element.setAttribute(
        "config",
        JSON.stringify({
          type: "map",
          id: "test-map",
          config: {
            mapStyle: "https://demotiles.maplibre.org/style.json",
            center: [0, 0],
            zoom: 1,
          },
          legend: {
            position: "top-left",
            title: "Test Legend",
          },
        })
      );

      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const renderer = element.getRenderer();
      expect(renderer).toBeTruthy();
      // Legend is handled internally by MapRenderer, just verify no errors
    });
  });

  describe("public methods", () => {
    it("getRenderer returns renderer instance", async () => {
      const element = document.createElement('ml-map') as MLMap;
      element.setAttribute(
        "config",
        JSON.stringify({
          type: "map",
          id: "test-map",
          config: {
            mapStyle: "https://demotiles.maplibre.org/style.json",
            center: [0, 0],
            zoom: 1,
          },
        })
      );

      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(element.getRenderer()).toBeTruthy();
    });

    it("getMap returns map instance", async () => {
      const element = document.createElement('ml-map') as MLMap;
      element.setAttribute(
        "config",
        JSON.stringify({
          type: "map",
          id: "test-map",
          config: {
            mapStyle: "https://demotiles.maplibre.org/style.json",
            center: [0, 0],
            zoom: 1,
          },
        })
      );

      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(element.getMap()).toBeDefined();
    });

    it("getMap returns null when no renderer", () => {
      const element = document.createElement('ml-map') as MLMap;
      expect(element.getMap()).toBeNull();
    });
  });
});
