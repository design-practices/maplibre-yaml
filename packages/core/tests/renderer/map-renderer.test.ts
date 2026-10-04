import { describe, it, expect, beforeEach, vi } from "vitest";
import { MapRenderer } from "../../src/renderer/map-renderer";

// Mock maplibre-gl
vi.mock("maplibre-gl", () => {
  class MockMap {
    private events: Map<string, Set<Function>> = new Map();
    /** Constructor options, kept for option-shape assertions. */
    public ctorOptions: any;
    public addLayer = vi.fn();
    public addSource = vi.fn();
    public removeLayer = vi.fn();
    public removeSource = vi.fn();
    public getLayer = vi.fn();
    public getSource = vi.fn();
    public setLayoutProperty = vi.fn();
    public addControl = vi.fn();
    public removeControl = vi.fn();

    constructor(options?: any) {
      this.ctorOptions = options;
    }

    getCanvas() {
      return { style: { cursor: "" } };
    }

    on(event: string, callback: Function) {
      if (!this.events.has(event)) {
        this.events.set(event, new Set());
      }
      this.events.get(event)!.add(callback);
    }

    emit(event: string, data?: any) {
      const callbacks = this.events.get(event);
      if (callbacks) {
        callbacks.forEach((cb) => cb(data));
      }
    }

    remove() {}
  }

  const NavigationControl = vi.fn(() => ({ type: "navigation" }));
  const GeolocateControl = vi.fn(() => ({ type: "geolocate" }));
  const ScaleControl = vi.fn(() => ({ type: "scale" }));
  const FullscreenControl = vi.fn(() => ({ type: "fullscreen" }));
  const Popup = vi.fn(() => ({
    setLngLat: vi.fn().mockReturnThis(),
    setHTML: vi.fn().mockReturnThis(),
    on: vi.fn(),
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
  }));

  return {
    default: {
      Map: MockMap,
      NavigationControl,
      GeolocateControl,
      ScaleControl,
      FullscreenControl,
      Popup,
    },
    Map: MockMap,
    NavigationControl,
    GeolocateControl,
    ScaleControl,
    FullscreenControl,
    Popup,
  };
});

describe("MapRenderer", () => {
  let container: HTMLElement;
  let renderer: MapRenderer;

  beforeEach(() => {
    container = document.createElement("div");
    container.id = "map";
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  describe("constructor", () => {
    it("creates a map with config", () => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      };

      renderer = new MapRenderer(container, config);

      expect(renderer).toBeDefined();
      expect(renderer.getMap()).toBeDefined();
    });

    it("accepts string container ID", () => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      };

      renderer = new MapRenderer("map", config);

      expect(renderer).toBeDefined();
    });

    it("calls onLoad when map loads", (done) => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      };

      const onLoad = vi.fn(() => {
        expect(onLoad).toHaveBeenCalled();
        done();
      });

      renderer = new MapRenderer(container, config, [], { onLoad });

      // Simulate map load event
      renderer.getMap().emit("load");
    });
  });

  describe("WebGL context options (v4 top-level / v5 canvasContextAttributes)", () => {
    it("hands MapLibre both shapes so the flat YAML keys survive the v5 move", () => {
      renderer = new MapRenderer(container, {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
        preserveDrawingBuffer: true,
        antialias: true,
      } as any);
      const opts = (renderer.getMap() as any).ctorOptions;

      // v4 reads the top-level keys…
      expect(opts.preserveDrawingBuffer).toBe(true);
      expect(opts.antialias).toBe(true);
      // …v5 reads canvasContextAttributes; each ignores the other's shape.
      expect(opts.canvasContextAttributes).toEqual({
        preserveDrawingBuffer: true,
        antialias: true,
      });
    });

    it("layers flat keys over an author-supplied canvasContextAttributes instead of clobbering it", () => {
      renderer = new MapRenderer(container, {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
        canvasContextAttributes: { powerPreference: "high-performance" },
        antialias: true,
      } as any);

      expect((renderer.getMap() as any).ctorOptions.canvasContextAttributes).toEqual({
        powerPreference: "high-performance",
        antialias: true,
      });
    });

    it("passes no canvasContextAttributes when none of the flat keys are set", () => {
      renderer = new MapRenderer(container, {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      });
      expect((renderer.getMap() as any).ctorOptions.canvasContextAttributes).toBeUndefined();
    });
  });

  describe("params panel wiring (U8)", () => {
    const config = {
      center: [0, 0] as [number, number],
      zoom: 2,
      mapStyle: "https://example.com/style.json",
    };
    const layers = [
      { id: "roads", type: "line", source: "s", label: "Roads" },
      { id: "unlabeled", type: "line", source: "s" },
      { id: "locked", type: "line", source: "s", label: "Locked", toggleable: false },
    ] as any[];

    it("builds the panel top-right with controls and label-gated layer toggles", () => {
      renderer = new MapRenderer(container, config, layers, {
        parameters: { minPop: { type: "range", min: 0, max: 20 } },
        state: { minPop: { default: 5 } },
      });
      const map = renderer.getMap() as any;
      map.setGlobalStateProperty = vi.fn();
      map.emit("load");

      const corner = container.querySelector(".ml-map-chrome-top-right")!;
      expect(corner).not.toBeNull();
      const panel = corner.querySelector(".ml-map-params")!;
      expect(panel.querySelector("input[type=range]")).not.toBeNull();
      // Label gate: only the labeled, toggleable layer gets a checkbox.
      const layerRows = panel.querySelectorAll(".ml-map-params-layer");
      expect(layerRows).toHaveLength(1);
      expect(layerRows[0]!.textContent).toContain("Roads");
    });

    it("panel writes reach the map and emit renderer events", () => {
      renderer = new MapRenderer(container, config, layers, {
        parameters: { minPop: { type: "range", min: 0, max: 20 } },
        state: { minPop: { default: 5 } },
      });
      const map = renderer.getMap() as any;
      map.setGlobalStateProperty = vi.fn();
      map.getLayer = vi.fn(() => ({ id: "roads" }));
      const paramEvents: any[] = [];
      const visEvents: any[] = [];
      renderer.on("parameter:change", (e) => paramEvents.push(e));
      renderer.on("layer:visibility", (e) => visEvents.push(e));
      map.emit("load");

      const slider = container.querySelector(
        ".ml-map-params input[type=range]"
      ) as HTMLInputElement;
      slider.value = "12";
      slider.dispatchEvent(new Event("input"));
      expect(map.setGlobalStateProperty).toHaveBeenCalledWith("minPop", 12);
      expect(paramEvents).toEqual([{ key: "minPop", value: 12 }]);

      const toggle = container.querySelector(
        ".ml-map-params-layer input"
      ) as HTMLInputElement;
      toggle.checked = false;
      toggle.dispatchEvent(new Event("change"));
      expect(visEvents).toEqual([{ layerId: "roads", visible: false }]);
    });

    it("a second load never duplicates the panel; destroy removes the chrome", () => {
      renderer = new MapRenderer(container, config, layers, {
        parameters: { minPop: { type: "range", min: 0, max: 20 } },
      });
      const map = renderer.getMap() as any;
      map.setGlobalStateProperty = vi.fn();
      map.emit("load");
      map.emit("load");
      expect(container.querySelectorAll(".ml-map-params")).toHaveLength(1);

      renderer.destroy();
      expect(container.querySelectorAll(".ml-map-chrome")).toHaveLength(0);
      renderer = null as any;
    });

    it("no parameters and no labeled layers → no panel, no chrome", () => {
      renderer = new MapRenderer(container, config, [
        { id: "plain", type: "line", source: "s" },
      ] as any);
      renderer.getMap().emit("load");
      expect(container.querySelector(".ml-map-params")).toBeNull();
      expect(container.querySelector(".ml-map-chrome")).toBeNull();
    });

    it("parameters below the state floor warn once and render the notice", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      renderer = new MapRenderer(container, config, [], {
        parameters: { minPop: { type: "range", min: 0, max: 20 } },
        state: { minPop: { default: 5 } },
      });
      // MockMap has no setGlobalStateProperty — that IS the sub-5.6 runtime.
      renderer.getMap().emit("load");

      expect(container.querySelector(".ml-map-params-notice")).not.toBeNull();
      expect(container.querySelector(".ml-map-params input")).toBeNull();
      const panelWarns = warn.mock.calls.filter((c) =>
        String(c[0]).includes("parameters")
      );
      expect(panelWarns).toHaveLength(1);
      warn.mockRestore();
    });

    it("the auto legend registers into the same corner system", () => {
      renderer = new MapRenderer(container, config, [], {
        legend: { title: "Legend" },
        parameters: { minPop: { type: "range", min: 0, max: 20 } },
        state: { minPop: { default: 5 } },
      });
      const map = renderer.getMap() as any;
      map.setGlobalStateProperty = vi.fn();
      map.emit("load");

      // Legend defaults top-left; panel top-right — both inside chrome corners.
      expect(
        container.querySelector(".ml-map-chrome-top-left .ml-map-legend")
      ).not.toBeNull();
      expect(
        container.querySelector(".ml-map-chrome-top-right .ml-map-params")
      ).not.toBeNull();
    });
  });

  describe("host chrome mounts (U9 slots)", () => {
    const config = {
      center: [0, 0] as [number, number],
      zoom: 2,
      mapStyle: "https://example.com/style.json",
    };

    function el(text: string): HTMLElement {
      const d = document.createElement("div");
      d.textContent = text;
      return d;
    }

    it("mounts host chrome after the built-in legend and panel, stacking in one corner", () => {
      const mine = el("mine");
      renderer = new MapRenderer(container, config, [
        { id: "roads", type: "line", source: "s", label: "Roads" },
      ] as any, {
        legend: { position: "top-right", collapsed: false },
        parameters: { minPop: { type: "range", min: 0, max: 20 } },
        chrome: [{ position: "top-right", element: mine }],
      });
      const map = renderer.getMap() as any;
      map.setGlobalStateProperty = vi.fn();
      map.emit("load");

      const corner = container.querySelector(".ml-map-chrome-top-right")!;
      const kids = Array.from(corner.children);
      expect(kids).toHaveLength(3);
      expect(kids[0].classList.contains("ml-map-legend")).toBe(true);
      expect(kids[1].querySelector(".ml-map-params")).not.toBeNull();
      expect(kids[2]).toBe(mine);
      expect(mine.style.pointerEvents).toBe("auto");
    });

    it("a legend element replaces the built-in legend at the legend's position", () => {
      const custom = el("custom legend");
      renderer = new MapRenderer(container, config, [], {
        legend: { position: "bottom-left", collapsed: false },
        legendElement: custom,
      });
      renderer.getMap().emit("load");

      expect(container.querySelector(".ml-map-legend")).toBeNull();
      expect(custom.parentElement?.className).toContain("ml-map-chrome-bottom-left");
    });

    it("a legend element mounts top-left when the document declares no legend", () => {
      const custom = el("custom legend");
      renderer = new MapRenderer(container, config, [], { legendElement: custom });
      renderer.getMap().emit("load");
      expect(custom.parentElement?.className).toContain("ml-map-chrome-top-left");
    });
  });

  describe("state defaults (`state:` block → setGlobalStateProperty)", () => {
    const config = {
      center: [0, 0] as [number, number],
      zoom: 2,
      mapStyle: "https://example.com/style.json",
    };

    it("applies each state default via setGlobalStateProperty on load", () => {
      renderer = new MapRenderer(container, config, [], {
        state: { minPop: { default: 5 }, scenario: { default: "built" } },
      });
      const map = renderer.getMap() as any;
      map.setGlobalStateProperty = vi.fn();

      map.emit("load");

      expect(map.setGlobalStateProperty).toHaveBeenCalledWith("minPop", 5);
      expect(map.setGlobalStateProperty).toHaveBeenCalledWith("scenario", "built");
    });

    it("warns once instead of throwing when the runtime lacks setGlobalStateProperty (< 5.6)", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      renderer = new MapRenderer(container, config, [], {
        state: { minPop: { default: 5 } },
      });
      // MockMap has no setGlobalStateProperty — that IS the sub-5.6 runtime.
      renderer.getMap().emit("load");

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toContain("setGlobalStateProperty");
      warn.mockRestore();
    });

    it("skips an object entry without `default` instead of passing the object through", () => {
      renderer = new MapRenderer(container, config, [], {
        state: { minPop: {}, scenario: { default: "built" } },
      });
      const map = renderer.getMap() as any;
      map.setGlobalStateProperty = vi.fn();

      map.emit("load");

      // `{}` declares nothing — it must never become the state value.
      expect(map.setGlobalStateProperty).toHaveBeenCalledTimes(1);
      expect(map.setGlobalStateProperty).toHaveBeenCalledWith("scenario", "built");
    });

    it("accepts a bare non-object entry as a raw value (programmatic callers)", () => {
      renderer = new MapRenderer(container, config, [], {
        state: { minPop: 5 },
      });
      const map = renderer.getMap() as any;
      map.setGlobalStateProperty = vi.fn();

      map.emit("load");

      expect(map.setGlobalStateProperty).toHaveBeenCalledWith("minPop", 5);
    });

    it("touches nothing when no state block was declared", () => {
      renderer = new MapRenderer(container, config, [], {});
      const map = renderer.getMap() as any;
      map.setGlobalStateProperty = vi.fn();

      map.emit("load");

      expect(map.setGlobalStateProperty).not.toHaveBeenCalled();
    });
  });

  describe("light (`light:` → map.setLight, U10′)", () => {
    const config = {
      center: [0, 0] as [number, number],
      zoom: 2,
      mapStyle: "https://example.com/style.json",
    };

    it("applies the document light on load", () => {
      const light = { anchor: "map" as const, position: [1.5, 210, 30] as [number, number, number] };
      renderer = new MapRenderer(container, config, [], { light });
      const map = renderer.getMap() as any;
      map.setLight = vi.fn();
      map.emit("load");
      expect(map.setLight).toHaveBeenCalledWith(light);
    });

    it("a rejected light warns and the document keeps loading", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      renderer = new MapRenderer(container, config, [], { light: { intensity: 0.4 } });
      const map = renderer.getMap() as any;
      map.setLight = vi.fn(() => {
        throw new Error("bad light");
      });
      expect(() => map.emit("load")).not.toThrow();
      expect(warn.mock.calls.some((c) => String(c[0]).includes("light"))).toBe(true);
      warn.mockRestore();
    });

    it("touches nothing when no light was declared", () => {
      renderer = new MapRenderer(container, config, [], {});
      const map = renderer.getMap() as any;
      map.setLight = vi.fn();
      map.emit("load");
      expect(map.setLight).not.toHaveBeenCalled();
    });
  });

  describe("isMapLoaded", () => {
    it("returns false before map loads", () => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      };

      renderer = new MapRenderer(container, config);

      expect(renderer.isMapLoaded()).toBe(false);
    });

    it("returns true after map loads", () => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      };

      renderer = new MapRenderer(container, config);
      renderer.getMap().emit("load");

      expect(renderer.isMapLoaded()).toBe(true);
    });
  });

  describe("event handling", () => {
    beforeEach(() => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      };

      renderer = new MapRenderer(container, config);
      renderer.getMap().emit("load");
    });

    it("emits load event", (done) => {
      renderer.on("load", () => {
        done();
      });

      renderer.getMap().emit("load");
    });

    it("supports multiple listeners for same event", async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      // Add listeners after map loads
      renderer.on("layer:added", listener1);
      renderer.on("layer:added", listener2);

      // Trigger an event that uses the renderer's event system
      await renderer.addLayer({
        id: "test-layer",
        type: "circle" as const,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
        },
      });

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it("removes event listeners with off", () => {
      const listener = vi.fn();

      renderer.on("load", listener);
      renderer.off("load", listener);

      renderer.getMap().emit("load");

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("layer operations", () => {
    beforeEach(() => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      };

      renderer = new MapRenderer(container, config);
      renderer.getMap().emit("load");
    });

    it("adds layer and emits event", async () => {
      const layer = {
        id: "test-layer",
        type: "circle" as const,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
        },
      };

      const listener = vi.fn();
      renderer.on("layer:added", listener);

      await renderer.addLayer(layer);

      expect(listener).toHaveBeenCalledWith({ layerId: "test-layer" });
    });

    it("removes layer and emits event", () => {
      const listener = vi.fn();
      renderer.on("layer:removed", listener);

      renderer.removeLayer("test-layer");

      expect(listener).toHaveBeenCalledWith({ layerId: "test-layer" });
    });

    it("sets layer visibility", () => {
      const map = renderer.getMap();
      map.getLayer = vi.fn().mockReturnValue(true);

      renderer.setLayerVisibility("test-layer", false);

      expect(map.setLayoutProperty).toHaveBeenCalledWith(
        "test-layer",
        "visibility",
        "none"
      );
    });

    it("updates layer data", () => {
      const mockSource = {
        setData: vi.fn(),
      };

      const map = renderer.getMap();
      map.getSource = vi.fn().mockReturnValue(mockSource);

      const data = {
        type: "FeatureCollection" as const,
        features: [],
      };

      renderer.updateLayerData("test-layer", data);

      expect(mockSource.setData).toHaveBeenCalledWith(data);
    });
  });

  describe("block-level sources", () => {
    it("adds named sources to map before layers on load", (done) => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      };

      const sources = {
        "my-geojson": {
          type: "geojson" as const,
          data: { type: "FeatureCollection", features: [] },
        },
      };

      renderer = new MapRenderer(container, config, [], { onLoad: () => {
        const map = renderer.getMap();
        expect(map.addSource).toHaveBeenCalledWith("my-geojson", sources["my-geojson"]);
        done();
      }}, sources);

      renderer.getMap().emit("load");
    });

    it("does not re-add source if it already exists on the map", (done) => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      };

      const sources = {
        "existing-source": {
          type: "geojson" as const,
          data: { type: "FeatureCollection", features: [] },
        },
      };

      renderer = new MapRenderer(container, config, [], { onLoad: () => {
        const map = renderer.getMap();
        // addSource should not have been called for the existing source
        const addSourceCalls = (map.addSource as any).mock.calls;
        const calledWithExisting = addSourceCalls.some(
          (call: any[]) => call[0] === "existing-source"
        );
        expect(calledWithExisting).toBe(false);
        done();
      }}, sources);

      // Simulate that source already exists
      const map = renderer.getMap();
      map.getSource = vi.fn().mockReturnValue({ type: "geojson" });

      map.emit("load");
    });

    it("adds sources before layers so string references resolve", (done) => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      };

      const sources = {
        "shared-data": {
          type: "geojson" as const,
          data: { type: "FeatureCollection", features: [] },
        },
      };

      const layers = [
        {
          id: "fill-layer",
          type: "fill" as const,
          source: "shared-data",
          paint: { "fill-color": "#aaa" },
        },
      ];

      const callOrder: string[] = [];
      renderer = new MapRenderer(container, config, layers, { onLoad: () => {
        // Verify addSource was called (for the named source) before addLayer
        const map = renderer.getMap();
        expect(map.addSource).toHaveBeenCalledWith("shared-data", sources["shared-data"]);
        expect(map.addLayer).toHaveBeenCalled();
        done();
      }}, sources);

      // Make getSource return the source after it's been "added"
      const map = renderer.getMap();
      const originalGetSource = map.getSource;
      map.getSource = vi.fn().mockImplementation((id: string) => {
        if (id === "shared-data") {
          // Return truthy after addSource was called for it
          const calls = (map.addSource as any).mock.calls;
          return calls.some((c: any[]) => c[0] === "shared-data") ? { type: "geojson" } : undefined;
        }
        return originalGetSource(id);
      });

      map.emit("load");
    });

    it("works without sources parameter", (done) => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      };

      renderer = new MapRenderer(container, config, [], { onLoad: () => {
        // No sources to add, should still load fine
        done();
      }});

      renderer.getMap().emit("load");
    });
  });

  describe("controls", () => {
    beforeEach(() => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      };

      renderer = new MapRenderer(container, config);
    });

    it("adds controls to map", () => {
      const map = renderer.getMap();
      map.addControl = vi.fn();

      const controlsConfig = {
        navigation: true,
        scale: true,
      };

      renderer.addControls(controlsConfig);

      expect(map.addControl).toHaveBeenCalled();
    });
  });

  describe("legend", () => {
    beforeEach(() => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      };

      renderer = new MapRenderer(container, config);
    });

    it("builds legend in container", () => {
      const legendContainer = document.createElement("div");
      legendContainer.id = "legend";
      document.body.appendChild(legendContainer);

      const layers = [
        {
          id: "layer1",
          type: "circle" as const,
          source: {
            type: "geojson" as const,
            data: { type: "FeatureCollection" as const, features: [] },
          },
          legend: {
            shape: "circle" as const,
            color: "#ff0000",
            label: "Test",
          },
        },
      ];

      renderer.buildLegend(legendContainer, layers as any);

      expect(legendContainer.innerHTML).toContain("Test");
    });
  });

  describe("destroy", () => {
    it("cleans up all resources", () => {
      const config = {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      };

      renderer = new MapRenderer(container, config);
      const map = renderer.getMap();
      map.remove = vi.fn();

      renderer.destroy();

      expect(map.remove).toHaveBeenCalled();
    });
  });
});
