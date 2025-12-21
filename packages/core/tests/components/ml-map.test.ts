import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { JSDOM } from "jsdom";

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
  let dom: JSDOM;
  let document: Document;
  let window: Window;

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
    global.CustomEvent = window.CustomEvent;
    global.customElements = window.customElements;

    // Register the custom element if not already registered
    if (!window.customElements.get("ml-map")) {
      window.customElements.define("ml-map", MLMap);
    }
  });

  afterEach(() => {
    dom.window.close();
  });

  describe("connectedCallback", () => {
    it("creates container div when connected", () => {
      const element = new MLMap();
      document.body.appendChild(element);

      const container = element.querySelector("div");
      expect(container).toBeTruthy();
      expect(container?.style.width).toBe("100%");
      expect(container?.style.height).toBe("100%");
    });

    it("dispatches error event when no config is found", (done) => {
      const element = new MLMap();

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
      const element = new MLMap();
      element.setAttribute(
        "config",
        JSON.stringify({type: "map",
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
      const element = new MLMap();
      element.setAttribute(
        "config",
        JSON.stringify({type: "map",
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
        JSON.stringify({type: "map",
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

      const element = new MLMap();
      element.setAttribute("config", JSON.stringify(config));

      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const renderer = element.getRenderer();
      expect(renderer).toBeTruthy();
      expect(renderer?.config).toEqual(config.config);
      expect(renderer?.layers).toEqual(config.layers);
    });

    it("handles invalid JSON in config attribute", (done) => {
      const element = new MLMap();
      element.setAttribute("config", "not valid json");

      element.addEventListener("error", () => {
        done();
      });

      document.body.appendChild(element);
    });
  });

  describe("config from YAML script", () => {
    it("parses valid YAML script", async () => {
      const element = new MLMap();
      const script = document.createElement("script");
      script.type = "application/yaml";
      script.textContent = `
type: map
config:
  mapStyle: https://demotiles.maplibre.org/style.json
  center: [-74.5, 40]
  zoom: 9
layers:
  - id: test-layer
    type: circle
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
      const element = new MLMap();
      const script = document.createElement("script");
      script.type = "application/yaml";
      script.textContent = "not: valid: yaml: structure:";
      element.appendChild(script);

      element.addEventListener("error", () => {
        done();
      });

      document.body.appendChild(element);
    });
  });

  describe("config from JSON script", () => {
    it("parses valid JSON script", async () => {
      const element = new MLMap();
      const script = document.createElement("script");
      script.type = "application/json";
      script.textContent = JSON.stringify({type: "map",
        config: {
          mapStyle: "https://demotiles.maplibre.org/style.json",
          center: [-74.5, 40],
          zoom: 9,
        },
      });
      element.appendChild(script);

      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const renderer = element.getRenderer();
      expect(renderer).toBeTruthy();
    });

    it("handles invalid JSON script", (done) => {
      const element = new MLMap();
      const script = document.createElement("script");
      script.type = "application/json";
      script.textContent = "not valid json";
      element.appendChild(script);

      element.addEventListener("error", () => {
        done();
      });

      document.body.appendChild(element);
    });
  });

  describe("config priority", () => {
    it("prefers config attribute over scripts", async () => {
      const element = new MLMap();

      // Add JSON script
      const jsonScript = document.createElement("script");
      jsonScript.type = "application/json";
      jsonScript.textContent = JSON.stringify({type: "map",
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
        JSON.stringify({type: "map",
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
      const element = new MLMap();
      element.setAttribute(
        "config",
        JSON.stringify({type: "map",
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
      const element = new MLMap();
      element.setAttribute(
        "config",
        JSON.stringify({type: "map",
          config: {
            mapStyle: "https://demotiles.maplibre.org/style.json",
            center: [0, 0],
            zoom: 1,
          },
          controls: {
            navigation: { position: "top-right" },
          },
        })
      );

      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const renderer = element.getRenderer();
      expect(renderer?.addControls).toHaveBeenCalledWith({
        navigation: { position: "top-right" },
      });
    });
  });

  describe("legend integration", () => {
    it("builds legend when specified in config", async () => {
      const legendContainer = document.createElement("div");
      legendContainer.id = "legend";
      document.body.appendChild(legendContainer);

      const element = new MLMap();
      element.setAttribute(
        "config",
        JSON.stringify({type: "map",
          config: {
            mapStyle: "https://demotiles.maplibre.org/style.json",
            center: [0, 0],
            zoom: 1,
          },
          legend: {
            container: "legend",
            title: "Test Legend",
          },
        })
      );

      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const renderer = element.getRenderer();
      expect(renderer?.getLegendBuilder).toHaveBeenCalled();
    });
  });

  describe("public methods", () => {
    it("getRenderer returns renderer instance", async () => {
      const element = new MLMap();
      element.setAttribute(
        "config",
        JSON.stringify({type: "map",
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
      const element = new MLMap();
      element.setAttribute(
        "config",
        JSON.stringify({type: "map",
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
      const element = new MLMap();
      expect(element.getMap()).toBeNull();
    });
  });
});
