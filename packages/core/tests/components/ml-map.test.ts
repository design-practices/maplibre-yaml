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
    on: vi.fn(),
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
        // Live documents (0.10): a changed document reaches the running map.
        getDocument: () => ({ config: mockRenderer.config, layers: mockRenderer.layers, sources: {}, options: mockRenderer.options }),
        update: vi.fn(async (next: any) => {
          mockRenderer.config = next.config;
          mockRenderer.layers = next.layers;
          return { outcome: "applied", summary: { added: [], removed: [], moved: [], replaced: [], propertiesSet: [], sourcesReplaced: [], cameraMoved: false, rebuild: false, failures: [] } };
        }),
        failedSources: () => new Set<string>(),
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
    it("updates the running map in place when the config attribute changes (live documents, 0.10)", async () => {
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

      expect(firstRenderer?.destroy).not.toHaveBeenCalled();
      expect(element.getRenderer()).toBe(firstRenderer);
      expect((firstRenderer as any).update).toHaveBeenCalledTimes(1);
      expect((firstRenderer as any).update.mock.calls[0][0].config.center).toEqual([10, 10]);
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

  // ml-4cn.2: every YAML/JSON media type, read by the one parser.
  describe("inline document script types", () => {
    const DOC = {
      type: "map",
      id: "inline-doc",
      config: {
        mapStyle: "https://demotiles.maplibre.org/style.json",
        center: [3, 4],
        zoom: 5,
      },
      layers: [],
    };
    const YAML_DOC = `type: map
id: inline-doc
config:
  mapStyle: https://demotiles.maplibre.org/style.json
  center: [3, 4]
  zoom: 5
layers: []
`;
    const withScript = (type: string, text: string) => {
      const element = document.createElement("ml-map") as MLMap;
      const script = document.createElement("script");
      script.setAttribute("type", type);
      script.textContent = text;
      element.appendChild(script);
      return element;
    };
    const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

    it.each([
      ["text/yaml", YAML_DOC],
      ["application/yaml", YAML_DOC],
      ["text/x-yaml", YAML_DOC],
      ["application/x-yaml", YAML_DOC],
      ["application/json", JSON.stringify(DOC, null, 2)],
      ["text/json", JSON.stringify(DOC)],
      ["Application/JSON; charset=utf-8", JSON.stringify(DOC)],
    ])("renders the document from <script type=%j>", async (type, text) => {
      const element = withScript(type, text);
      document.body.appendChild(element);
      await tick();

      expect(element.querySelector(".ml-map-error")).toBeNull();
      expect(element.getRenderer()?.config.center).toEqual([3, 4]);
    });

    it("ignores other script types (no document there)", async () => {
      const element = withScript("application/ld+json", JSON.stringify(DOC));
      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(element.getRenderer()).toBeNull();
      expect(element.querySelector(".ml-map-error")?.textContent).toContain(
        "No configuration provided"
      );
    });

    it("the first document script wins, whatever its type", async () => {
      const element = withScript(
        "application/json",
        JSON.stringify({ ...DOC, config: { ...DOC.config, center: [7, 8] } })
      );
      const second = document.createElement("script");
      second.type = "text/yaml";
      second.textContent = YAML_DOC;
      element.appendChild(second);
      document.body.appendChild(element);
      await tick();
      expect(element.getRenderer()?.config.center).toEqual([7, 8]);
    });

    it("a JSON script inside slot content is not the map's document", async () => {
      const element = document.createElement("ml-map") as MLMap;
      element.innerHTML =
        '<div slot="top-right"><script type="application/json">{"widget": true}</script></div>' +
        `<script type="application/json">${JSON.stringify(DOC)}</script>`;
      document.body.appendChild(element);
      await tick();
      expect(element.querySelector(".ml-map-error")).toBeNull();
      expect(element.getRenderer()?.config.center).toEqual([3, 4]);
    });

    it("reload() re-reads a JSON script", async () => {
      const element = withScript("application/json", JSON.stringify(DOC));
      document.body.appendChild(element);
      await tick();
      element.querySelector("script")!.textContent = JSON.stringify({
        ...DOC,
        config: { ...DOC.config, center: [9, 9] },
      });
      await element.reload();
      await tick();
      expect(element.getRenderer()?.config.center).toEqual([9, 9]);
    });

    it("a JSON syntax error says JSON, with its line", async () => {
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      const element = withScript(
        "application/json",
        '{\n  "type": "map",\n  "id": "x"\n  "layers": []\n}'
      );
      document.body.appendChild(element);
      await tick();
      const card = element.querySelector(".ml-map-error")!;
      expect(card.textContent).toContain("JSON syntax error");
      expect(card.textContent).not.toContain("YAML syntax error");
      expect(card.textContent).toMatch(/line \d+/);
      quiet.mockRestore();
    });

    it("the same broken text in a YAML script still says YAML", async () => {
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      const element = withScript(
        "text/yaml",
        '{\n  "type": "map",\n  "id": "x"\n  "layers": []\n}'
      );
      document.body.appendChild(element);
      await tick();
      expect(element.querySelector(".ml-map-error")!.textContent).toContain(
        "YAML syntax error"
      );
      quiet.mockRestore();
    });
  });

  describe("config priority", () => {
    // Documented order: property > inline script > src > config attribute.
    // Before ml-4cn.2 a JSON script was never read, so the attribute won.
    it("prefers an inline JSON script over the config attribute", async () => {
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
      expect(renderer?.config.mapStyle).toBe("https://script.com/style.json");
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

  describe("slots + targeted teardown (U9, KTD9)", () => {
    const YAML = `
type: map
id: slot-map
config:
  mapStyle: https://demotiles.maplibre.org/style.json
  center: [0, 0]
  zoom: 2
layers: []
`;
    const tick = () => new Promise((r) => setTimeout(r, 10));

    function build(children: string): MLMap {
      const element = document.createElement("ml-map") as MLMap;
      element.innerHTML = `<script type="text/yaml">${YAML}</script>${children}`;
      return element;
    }

    // The mock renderer never mounts chrome; move a borrowed element into
    // the map container the way the real renderer's corner system does.
    function simulateMount(element: MLMap, child: Element) {
      const corner = document.createElement("div");
      corner.className = "ml-map-chrome ml-map-chrome-top-right";
      element.querySelector(".ml-map-container")!.appendChild(corner);
      corner.appendChild(child);
    }

    it("hands corner slots and the legend override to the renderer", async () => {
      const element = build(
        '<div slot="top-right" id="tr">tr</div>' +
          '<div slot="bottom-left" id="bl">bl</div>' +
          '<div slot="legend" id="lg">legend</div>'
      );
      document.body.appendChild(element);
      await tick();

      const options = (element.getRenderer() as any).options;
      expect(
        options.chrome.map((m: any) => [m.position, m.element.id])
      ).toEqual([
        ["top-right", "tr"],
        ["bottom-left", "bl"],
      ]);
      expect(options.legendElement.id).toBe("lg");
    });

    it("warns about an unknown slot name and leaves the child in place", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const element = build('<div slot="middle" id="mid">?</div>');
      document.body.appendChild(element);
      await tick();

      expect((element.getRenderer() as any).options.chrome).toEqual([]);
      expect(element.querySelector("#mid")?.parentElement).toBe(element);
      expect(warn.mock.calls.some((c) => String(c[0]).includes('unknown slot "middle"'))).toBe(true);
      warn.mockRestore();
    });

    it("keeps the inline YAML script, so reload() re-reads it and updates the map in place", async () => {
      const element = build("");
      document.body.appendChild(element);
      await tick();
      const first = element.getRenderer();

      expect(element.querySelector('script[type="text/yaml"]')).not.toBeNull();
      await element.reload();
      await tick();

      // Live documents (0.10): the same map, asked to apply the re-read document.
      expect(element.getRenderer()).toBe(first);
      expect((first as any).destroyed).toBe(false);
      expect((first as any).update).toHaveBeenCalledTimes(1);
    });

    it("a mounted slot child survives reload: the map is updated in place and keeps it", async () => {
      const element = build('<div slot="top-right" id="tr">tr</div>');
      document.body.appendChild(element);
      await tick();
      const child = element.querySelector("#tr")!;
      simulateMount(element, child);

      await element.reload();
      await tick();

      expect(child.isConnected).toBe(true);
      expect(child.closest(".ml-map-container")).not.toBeNull();
      const options = (element.getRenderer() as any).options;
      expect(options.chrome[0].element).toBe(child);
    });

    it("a broken document on a running map keeps the map and its slots; the error card only replaces a map that never rendered", async () => {
      const element = build('<div slot="top-right" id="tr">tr</div>');
      document.body.appendChild(element);
      await tick();
      const child = element.querySelector("#tr")!;
      simulateMount(element, child);
      const script = element.querySelector('script[type="text/yaml"]')!;

      // Break the document: the running map is kept (live documents, R2).
      script.textContent = "type: map\nid: broken\n";
      await element.reload();
      await tick();
      expect(element.querySelector(".ml-map-error")).toBeNull();
      expect(element.querySelector(".ml-map-container")).not.toBeNull();
      expect(child.closest(".ml-map-container")).not.toBeNull();
      expect(script.isConnected).toBe(true);
    });

    it("slot children survive an error-card-then-reload cycle", async () => {
      const element = build('<div slot="top-right" id="tr">tr</div>');
      const script = element.querySelector('script[type="text/yaml"]')!;
      script.textContent = "type: map\nid: broken\n";
      const child = element.querySelector("#tr")!;
      document.body.appendChild(element);
      await tick();
      // The card replaces the map container, not the host: the slot child stays.
      expect(element.querySelector(".ml-map-error")).not.toBeNull();
      expect(element.querySelector(".ml-map-container")).toBeNull();
      expect(child.parentElement).toBe(element);

      // Fix it and reload: the card goes, the map renders and takes the slot.
      script.textContent = YAML;
      await element.reload();
      await tick();
      expect(element.querySelector(".ml-map-error")).toBeNull();
      expect(element.querySelector(".ml-map-container")).not.toBeNull();
      expect((element.getRenderer() as any).options.chrome[0].element).toBe(child);
    });

    it("disconnect parks borrowed slot children back on the element", async () => {
      const element = build('<div slot="top-left" id="tl">tl</div>');
      document.body.appendChild(element);
      await tick();
      const child = element.querySelector("#tl")!;
      simulateMount(element, child);

      element.remove();
      expect(child.parentElement).toBe(element);
    });
  });

  describe("mapReady (U2, R3)", () => {
    it("resolves with the map when ml-map:load fires", async () => {
      const element = document.createElement('ml-map') as MLMap;
      const ready = element.mapReady();

      // Simulate the renderer wiring: a map exists and the load event fires.
      const fakeMap = { on: vi.fn(), off: vi.fn() };
      (element as any).renderer = {
        isMapLoaded: () => true,
        getMap: () => fakeMap,
      };
      element.dispatchEvent(new CustomEvent("ml-map:load", { detail: {} }));

      await expect(ready).resolves.toBe(fakeMap);
    });

    it("resolves immediately when the document is already loaded", async () => {
      const element = document.createElement('ml-map') as MLMap;
      const fakeMap = { on: vi.fn(), off: vi.fn() };
      (element as any).renderer = {
        isMapLoaded: () => true,
        getMap: () => fakeMap,
      };
      // The fast path keys on DOCUMENT readiness (every layer added), not
      // MapLibre's earlier map-load — isMapLoaded() alone must not trigger it.
      (element as any).documentLoaded = true;

      await expect(element.mapReady()).resolves.toBe(fakeMap);
    });

    it("does not fast-resolve on map-load alone (layers still pending)", async () => {
      const element = document.createElement('ml-map') as MLMap;
      const fakeMap = { on: vi.fn(), off: vi.fn() };
      (element as any).renderer = {
        isMapLoaded: () => true, // MapLibre map loaded…
        getMap: () => fakeMap,
      };
      // …but the document (layers) hasn't finished: promise must stay pending
      // until ml-map:load.
      const ready = element.mapReady();
      let settled = false;
      ready.then(() => (settled = true), () => (settled = true));
      await new Promise((r) => setTimeout(r, 5));
      expect(settled).toBe(false);

      element.dispatchEvent(new CustomEvent("ml-map:load", { detail: {} }));
      await expect(ready).resolves.toBe(fakeMap);
    });

    it("rejects when ml-map:error fires first", async () => {
      const element = document.createElement('ml-map') as MLMap;
      const ready = element.mapReady();
      const boom = new Error("bad document");

      element.dispatchEvent(
        new CustomEvent("ml-map:error", { detail: { error: boom } })
      );

      await expect(ready).rejects.toBe(boom);
    });

    it("rejects immediately when called AFTER the document already failed", async () => {
      const element = document.createElement('ml-map') as MLMap;
      // Simulate the real failure path: handleError dispatched once, long ago.
      (element as any).handleError([{ path: "layers", message: "no such source" }]);

      await expect(element.mapReady()).rejects.toThrow(/layers: no such source/);
    });

    it("rejects with readable messages from handleError's ParseError[] shape", async () => {
      const element = document.createElement('ml-map') as MLMap;
      const ready = element.mapReady();

      element.dispatchEvent(
        new CustomEvent("ml-map:error", {
          detail: { errors: [{ path: "config", message: "mapStyle is required" }] },
        })
      );

      await expect(ready).rejects.toThrow(/config: mapStyle is required/);
    });

    it("ignores non-fatal runtime errors and still resolves on load", async () => {
      const element = document.createElement('ml-map') as MLMap;
      const fakeMap = { on: vi.fn(), off: vi.fn() };
      (element as any).renderer = { isMapLoaded: () => true, getMap: () => fakeMap };
      const ready = element.mapReady();

      // A 404'd tile before load: non-fatal, must not settle readiness.
      element.dispatchEvent(
        new CustomEvent("ml-map:error", {
          detail: { error: new Error("tile 404"), fatal: false },
        })
      );
      element.dispatchEvent(new CustomEvent("ml-map:load", { detail: {} }));

      await expect(ready).resolves.toBe(fakeMap);
    });
  });
});

// U4 (ml-4cn): every way a document comes in reads YAML, JSON and TOML
// through the one front door. The TOML reader is the real lazy chunk here.
describe("documents in YAML, JSON and TOML (U4)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    if (!customElements.get("ml-map")) customElements.define("ml-map", MLMap);
  });
  const STYLE = "https://demotiles.maplibre.org/style.json";
  const YAML_DOC = `type: map
id: formats
config:
  center: [3, 4]
  zoom: 5
  mapStyle: "${STYLE}"
layers:
  - id: pts
    type: circle
    source:
      type: geojson
      data: { type: FeatureCollection, features: [] }
    paint: { circle-color: "#d62828" }
`;
  const TOML_DOC = `type = "map"
id = "formats"

[config]
center = [3, 4]
zoom = 5
mapStyle = "${STYLE}"

[[layers]]
id = "pts"
type = "circle"
paint = { circle-color = "#d62828" }

[layers.source]
type = "geojson"
data = { type = "FeatureCollection", features = [] }
`;
  const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
  /** Wait until the element shows a map or a card (the TOML reader is a dynamic import). */
  const settled = async (el: MLMap) => {
    for (let i = 0; i < 200 && !el.getRenderer() && !el.querySelector(".ml-map-error"); i++) await tick(5);
  };
  const withScript = (type: string, text: string) => {
    const element = document.createElement("ml-map") as MLMap;
    const script = document.createElement("script");
    script.setAttribute("type", type);
    script.textContent = text;
    element.appendChild(script);
    return element;
  };
  /** What the renderer was built with, minus nothing: the map the document draws. */
  const drawn = (el: MLMap) => {
    const r = el.getRenderer() as any;
    return { config: r?.config, layers: r?.layers };
  };

  it("AE1: a TOML config attribute renders the same map as the YAML original; JSON text too", async () => {
    const yaml = withScript("text/yaml", YAML_DOC);
    const toml = document.createElement("ml-map") as MLMap;
    toml.setAttribute("config", TOML_DOC);
    const json = document.createElement("ml-map") as MLMap;
    json.setAttribute("config", JSON.stringify({
      type: "map",
      id: "formats",
      config: { center: [3, 4], zoom: 5, mapStyle: STYLE },
      layers: [{ id: "pts", type: "circle", source: { type: "geojson", data: { type: "FeatureCollection", features: [] } }, paint: { "circle-color": "#d62828" } }],
    }));
    document.body.append(yaml, toml, json);
    for (const el of [yaml, toml, json]) await settled(el);
    expect(toml.querySelector(".ml-map-error")).toBeNull();
    expect(json.querySelector(".ml-map-error")).toBeNull();
    expect(drawn(toml)).toEqual(drawn(yaml));
    expect(drawn(json)).toEqual(drawn(yaml));
    expect(toml.getDocument()).toEqual(yaml.getDocument());
  });

  it("AE1: YAML whose string values contain ` = ` stays YAML", async () => {
    const el = document.createElement("ml-map") as MLMap;
    el.setAttribute("config", YAML_DOC.replace("id: formats", 'id: formats\ntitle: "a = b"'));
    document.body.appendChild(el);
    await settled(el);
    expect(el.querySelector(".ml-map-error")).toBeNull();
    expect(el.getDocument()?.id).toBe("formats");
  });

  it.each(["application/toml", "text/toml", "application/x-toml", "text/x-toml"])(
    "an inline <script type=%j> renders, and the stylesheet hides it",
    async (type) => {
      const el = withScript(type, TOML_DOC);
      document.body.appendChild(el);
      await settled(el);
      expect(el.querySelector(".ml-map-error")).toBeNull();
      expect(el.getRenderer()?.config.center).toEqual([3, 4]);
      const { defaultStyles } = await import("../../src/components/styles");
      expect(defaultStyles).toContain(`ml-map script[type="${type}"]`);
    }
  );

  it("a script type that looks like a document but isn't supported is named in the card, not 'No configuration provided' (R5)", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = withScript("text/x-yaml5", YAML_DOC);
    document.body.appendChild(el);
    await tick(600);
    const card = el.querySelector(".ml-map-error")!.textContent!;
    expect(card).toContain('<script type="text/x-yaml5">');
    expect(card).toContain("isn't a type maplibre-yaml reads");
    expect(card).not.toContain("No configuration provided");
    quiet.mockRestore();
  });

  it("an empty supported script with a src says the script is empty and its src is not loaded, not that its type is unsupported", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = document.createElement("ml-map") as MLMap;
    const script = document.createElement("script");
    script.setAttribute("type", "text/yaml");
    script.setAttribute("src", "maps/city.yaml");
    el.appendChild(script);
    document.body.appendChild(el);
    await tick(600);
    const card = el.querySelector(".ml-map-error")!.textContent!;
    expect(card).not.toContain("isn't a type maplibre-yaml reads");
    expect(card).toContain('<script type="text/yaml"> is empty');
    expect(card).toContain("src attribute is not loaded");
    expect(card).toContain('<ml-map src="maps/city.yaml">');
    expect(card).not.toContain("No configuration provided");
    quiet.mockRestore();
  });

  it("an empty supported script says it is empty, ahead of an unsupported one after it", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = withScript("application/json", "");
    const other = document.createElement("script");
    other.setAttribute("type", "text/x-yaml5");
    other.textContent = YAML_DOC;
    el.appendChild(other);
    document.body.appendChild(el);
    await tick(600);
    const card = el.querySelector(".ml-map-error")!.textContent!;
    expect(card).toContain('<script type="application/json"> is empty');
    expect(card).not.toContain("isn't a type maplibre-yaml reads");
    expect(card).not.toContain("src attribute");
    quiet.mockRestore();
  });

  it("a TOML config attribute whose multi-line string holds a column-0 `Source:` line renders (no signal, sniffed)", async () => {
    const el = document.createElement("ml-map") as MLMap;
    el.setAttribute(
      "config",
      TOML_DOC.replace('id = "formats"', 'id = "formats"\ndescription = """\nQuakes this week.\nSource: NASA earthquake feed\n"""')
    );
    document.body.appendChild(el);
    await settled(el);
    expect(el.querySelector(".ml-map-error")).toBeNull();
    expect(el.getDocument()?.id).toBe("formats");
  });

  it.each(["module", "importmap", "application/ld+json"])("a %j script still says 'No configuration provided'", async (type) => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = withScript(type, "{}");
    document.body.appendChild(el);
    await tick(600);
    expect(el.querySelector(".ml-map-error")!.textContent).toContain("No configuration provided");
    quiet.mockRestore();
  });

  it("a duplicate key in a JSON config attribute is an error with a position (was silently last-wins)", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = document.createElement("ml-map") as MLMap;
    const errors: any[] = [];
    el.addEventListener("ml-map:error", (e) => errors.push(...((e as CustomEvent).detail.errors ?? [])));
    el.setAttribute("config", `{
  "type": "map",
  "id": "dup",
  "config": { "center": [0, 0], "zoom": 2, "zoom": 3, "mapStyle": "${STYLE}" },
  "layers": []
}`);
    document.body.appendChild(el);
    await settled(el);
    expect(el.getRenderer()).toBeNull();
    expect(errors[0]).toMatchObject({ format: "json", line: 4 });
    expect(errors[0].message).toMatch(/unique|duplicate/i);
    expect(el.querySelector(".ml-map-error")!.textContent).toContain("line 4");
    quiet.mockRestore();
  });

  it("a merge fan-out document in the config attribute shows the yaml-expansion card", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    let s = "type: map\nid: bomb\na0: &a0 { k: v }\n";
    for (let i = 1; i <= 6; i++) s += `a${i}: &a${i}\n  <<: [${Array.from({ length: 9 }, () => `*a${i - 1}`).join(",")}]\n`;
    const el = document.createElement("ml-map") as MLMap;
    const errors: any[] = [];
    el.addEventListener("ml-map:error", (e) => errors.push(...((e as CustomEvent).detail.errors ?? [])));
    el.setAttribute("config", `${s}layers: []\n`);
    const started = Date.now();
    document.body.appendChild(el);
    await settled(el);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(errors[0]?.code).toBe("yaml-expansion");
    expect(el.querySelector(".ml-map-error")!.textContent).toMatch(/sequence of aliases/i);
    quiet.mockRestore();
  });

  it("the config property given TOML text, before connect, renders when the element connects (getter null until read)", async () => {
    const el = document.createElement("ml-map") as MLMap;
    el.config = TOML_DOC;
    expect(el.config).toBeNull();
    document.body.appendChild(el);
    await settled(el);
    expect(el.getRenderer()?.config.zoom).toBe(5);
    expect(el.config?.id).toBe("formats");
  });

  it("YAML and JSON text still render in the same turn (no await before the map is built)", () => {
    const el = document.createElement("ml-map") as MLMap;
    el.setAttribute("config", YAML_DOC);
    document.body.appendChild(el);
    expect(el.getRenderer()).toBeTruthy();
  });
});
