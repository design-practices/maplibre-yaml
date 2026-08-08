import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock maplibre-gl before any imports
vi.mock("maplibre-gl", () => {
  const Map = vi.fn(() => ({
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
  }));
  const Popup = vi.fn(() => ({
    setLngLat: vi.fn().mockReturnThis(),
    setHTML: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
  }));
  const NavigationControl = vi.fn();
  const GeolocateControl = vi.fn();
  const ScaleControl = vi.fn();
  const FullscreenControl = vi.fn();
  return {
    default: { Map, Popup, NavigationControl, GeolocateControl, ScaleControl, FullscreenControl },
    Map,
    Popup,
    NavigationControl,
    GeolocateControl,
    ScaleControl,
    FullscreenControl,
  };
});

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

    it("renders a format-v2 document (basemap guard reads style.basemap)", async () => {
      // The flagship <ml-map> path must accept v2: the pre-render basemap guard
      // reads `style.basemap` under v2 rather than the v1-only `config.mapStyle`,
      // and dispatch flows through toModel to the same renderer. (AE3 / U1 :338.)
      const v2 = {
        version: 2 as const,
        type: "map" as const,
        id: "v2-map",
        style: {
          basemap: "https://demotiles.maplibre.org/style.json",
          center: [-74.5, 40] as [number, number],
          zoom: 9,
          layers: [
            {
              id: "v2-layer",
              type: "circle" as const,
              source: {
                type: "geojson" as const,
                data: { type: "FeatureCollection" as const, features: [] },
              },
              runtime: { toggleable: false },
            },
          ],
        },
      };

      const element = document.createElement('ml-map') as MLMap;
      element.setAttribute("config", JSON.stringify(v2));

      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // A renderer means the v2 document cleared the guard and reached render —
      // not the "basemap is required" error card that a v1-only guard produced.
      const renderer = element.getRenderer();
      expect(renderer).toBeTruthy();
      expect(renderer?.config.mapStyle).toBe(v2.style.basemap);
      expect(renderer?.config.center).toEqual(v2.style.center);
      expect(renderer?.layers).toHaveLength(1);
      expect(renderer?.layers[0].id).toBe("v2-layer");
    });
  });

  describe("non-YAML config paths are validated (U9)", () => {
    /** A structurally valid block, minus whatever the caller breaks. */
    const validBlock = () => ({
      type: "map" as const,
      id: "m",
      config: {
        mapStyle: "https://demotiles.maplibre.org/style.json",
        center: [-74.5, 40] as [number, number],
        zoom: 9,
      },
      layers: [],
    });

    const mount = async (mutate: (b: any) => any) => {
      const element = document.createElement("ml-map") as MLMap;
      element.setAttribute("config", JSON.stringify(mutate(validBlock())));
      document.body.appendChild(element);
      await new Promise((r) => setTimeout(r, 20));
      return element;
    };

    it("renders the error card for well-formed JSON that fails the schema", async () => {
      // Parsed fine, so the JSON guard let it through — but zoom is not a
      // string, and previously this reached renderMap unvalidated.
      const element = await mount((b) => ({ ...b, config: { ...b.config, zoom: "not-a-number" } }));

      expect(element.querySelector(".ml-map-error")).toBeTruthy();
      expect(element.getRenderer()).toBeFalsy();
    });

    it("renders the error card when a required field is missing", async () => {
      const element = await mount((b) => {
        const { config, ...rest } = b;
        return { ...rest, config: { center: [0, 0], zoom: 2 } }; // no mapStyle
      });

      expect(element.querySelector(".ml-map-error")).toBeTruthy();
    });

    it("warns about a typo'd key instead of dropping it silently", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await mount((b) => ({
        ...b,
        layers: [
          {
            id: "p",
            type: "circle",
            source: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            paint: { "circle-radis": 4 },
          },
        ],
      }));

      const messages = warn.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(messages).toContain("circle-radis");
      warn.mockRestore();
    });

    it("surfaces deprecations set programmatically", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const element = document.createElement("ml-map") as MLMap;
      document.body.appendChild(element);
      await new Promise((r) => setTimeout(r, 10));

      element.config = {
        ...validBlock(),
        layers: [
          {
            id: "p",
            type: "circle",
            source: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            interactive: { click: { action: "doThing" } },
          },
        ],
      } as any;
      await new Promise((r) => setTimeout(r, 20));

      const messages = warn.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(messages).toContain("deprecated");
      warn.mockRestore();
    });

    it("still renders a valid JSON config unchanged", async () => {
      const element = await mount((b) => b);

      expect(element.querySelector(".ml-map-error")).toBeFalsy();
      expect(element.getRenderer()).toBeTruthy();
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
      // Controls are threaded through to MapRenderer via the options parameter,
      // where the renderer applies them on map load
      expect((renderer as any)?.options.controls).toEqual({
        navigation: { enabled: true, position: "top-right" },
      });
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
      // Legend config is threaded through to MapRenderer via the options
      // parameter, where the renderer builds it on map load
      // `collapsed` is a schema default. It appears here now that the JSON
      // attribute is validated like the YAML paths — previously the raw object
      // reached the renderer with no defaults applied, so the two entry points
      // produced different configs from the same input.
      expect((renderer as any)?.options.legend).toEqual({
        position: "top-left",
        title: "Test Legend",
        collapsed: false,
      });
    });
  });

  describe("missing mapStyle", () => {
    it("shows the error card instead of constructing MapRenderer", async () => {
      const element = document.createElement("ml-map") as MLMap;
      const script = document.createElement("script");
      script.type = "text/yaml";
      // Valid per schema (mapStyle is optional for Astro-builder inheritance),
      // but a standalone <ml-map> has no global config to inherit from
      script.textContent = `
type: map
id: test-map
config:
  center: [0, 0]
  zoom: 1
layers: []
`;
      element.appendChild(script);

      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(element.getRenderer()).toBeNull();

      const errorCard = element.querySelector(".ml-map-error");
      expect(errorCard).toBeTruthy();
      expect(errorCard!.textContent).toContain(
        "mapStyle is required for standalone maps"
      );
      expect(errorCard!.textContent).toContain(
        'mapStyle: "https://demotiles.maplibre.org/style.json"'
      );
      expect(errorCard!.textContent).toContain("Astro builders");
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
