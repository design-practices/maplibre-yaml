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

    off(event: string, callback: Function) {
      this.events.get(event)?.delete(callback);
    }

    remove() {}
  }

  const NavigationControl = vi.fn(() => ({ type: "navigation" }));
  const GeolocateControl = vi.fn(() => ({ type: "geolocate" }));
  const ScaleControl = vi.fn(() => ({ type: "scale" }));
  const FullscreenControl = vi.fn(() => ({ type: "fullscreen" }));
  const AttributionControl = vi.fn(() => ({ type: "attribution" }));
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
      AttributionControl,
      Popup,
    },
    Map: MockMap,
    NavigationControl,
    GeolocateControl,
    ScaleControl,
    FullscreenControl,
    AttributionControl,
    Popup,
  };
});

import { beforeIdOf, documentOrderMoves } from "../../src/renderer/update/order";

describe("first render puts layers in document order (KTD3, live documents)", () => {
  const EMPTY = { type: "FeatureCollection", features: [] } as const;
  const config = { center: [0, 0] as [number, number], zoom: 2, mapStyle: "https://example.com/style.json" };
  const inline = (id: string) => ({ id, type: "circle", source: { type: "geojson", data: EMPTY } }) as any;

  it("a named-source layer among inline-source layers: style order equals document order after load", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const layers = [inline("areas"), inline("routes"), { id: "towns", type: "circle", source: "pts" } as any, inline("grades")];
    const renderer = new MapRenderer(container, config, layers, {}, { pts: { type: "geojson", data: EMPTY } as any });
    const map = renderer.getMap() as any;
    // A style that keeps order and its sources, as MapLibre does.
    const order: string[] = ["land"];
    const sources: Record<string, unknown> = {};
    map.addSource.mockImplementation((id: string, spec: any) => {
      sources[id] = { ...spec, setData: vi.fn() };
    });
    map.getSource.mockImplementation((id: string) => sources[id]);
    map.addLayer.mockImplementation((spec: any, before?: string) => {
      const at = before ? order.indexOf(before) : -1;
      if (at >= 0) order.splice(at, 0, spec.id);
      else order.push(spec.id);
    });
    map.getLayer.mockImplementation((id: string) => (order.includes(id) ? { id } : undefined));
    map.moveLayer = vi.fn((id: string, before?: string) => {
      order.splice(order.indexOf(id), 1);
      const at = before ? order.indexOf(before) : -1;
      if (at >= 0) order.splice(at, 0, id);
      else order.push(id);
    });
    map.getStyle = () => ({ layers: order.map((id) => ({ id })) });

    const loaded = new Promise<void>((resolve) => renderer.on("load", () => resolve()));
    map.emit("load");
    await loaded;
    expect(order.filter((id) => id !== "land")).toEqual(["areas", "routes", "towns", "grades"]);
    renderer.destroy();
  });

  it("the shared rule moves only what is out of place: the fixture's named-source layer landing first", () => {
    const docs = ["areas", "routes", "towns", "grades"].map((id) => ({ id }) as any);
    expect(documentOrderMoves(docs, ["land", "towns", "areas", "routes", "grades"])).toEqual([{ layerId: "towns", beforeId: "grades" }]);
    expect(documentOrderMoves(docs, ["land", "areas", "routes", "towns", "grades"])).toEqual([]);
    // A `before:` naming a basemap layer is honoured for that layer (KTD3).
    expect(documentOrderMoves([{ id: "a", before: "land" }, { id: "b" }] as any, ["land", "b", "a"])).toEqual([{ layerId: "a", beforeId: "land" }]);
  });
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

  describe("map-level 3D (U15)", () => {
    const config = {
      center: [0, 0] as [number, number],
      zoom: 2,
      mapStyle: "https://example.com/style.json",
    };
    const flush = () => new Promise((r) => setTimeout(r, 0));

    it("applies projection, sky, and terrain on load (a v5-shaped runtime)", () => {
      renderer = new MapRenderer(container, config, [], {
        projection: { type: "globe" },
        sky: { "sky-color": "#199EF3", "atmosphere-blend": 0.5 },
        terrain: { source: "dem", exaggeration: 1.5 },
      });
      const map = renderer.getMap() as any;
      map.setProjection = vi.fn();
      map.setSky = vi.fn();
      map.setTerrain = vi.fn();
      map.getSource = vi.fn(() => ({ type: "raster-dem" }));
      map.emit("load");

      expect(map.setProjection).toHaveBeenCalledWith({ type: "globe" });
      expect(map.setSky).toHaveBeenCalledWith({
        "sky-color": "#199EF3",
        "atmosphere-blend": 0.5,
      });
      expect(map.setTerrain).toHaveBeenCalledWith({ source: "dem", exaggeration: 1.5 });
    });

    it("a 4.x runtime (no setProjection) declares globe's absence with exactly one warning", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      renderer = new MapRenderer(container, config, [], { projection: { type: "globe" } });
      // MockMap has no setProjection — that IS the 4.x runtime.
      renderer.getMap().emit("load");
      const globeWarns = warn.mock.calls.filter((c) => String(c[0]).includes("projection"));
      expect(globeWarns).toHaveLength(1);
      expect(String(globeWarns[0]![0])).toContain("5.0.0");
      warn.mockRestore();
    });

    it("terrain whose source arrives with an inline layer source retries after layers", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      renderer = new MapRenderer(container, config, [], { terrain: { source: "late" } });
      const map = renderer.getMap() as any;
      map.setTerrain = vi.fn();
      let exists = false;
      map.getSource = vi.fn(() => (exists ? { type: "raster-dem" } : undefined));
      map.emit("load");
      expect(map.setTerrain).not.toHaveBeenCalled();
      exists = true;
      await flush();
      expect(map.setTerrain).toHaveBeenCalledWith({ source: "late" });
      expect(warn.mock.calls.filter((c) => String(c[0]).includes("terrain"))).toEqual([]);
      warn.mockRestore();
    });

    it("terrain naming no source warns once after layers settle and never throws", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const onError = vi.fn();
      renderer = new MapRenderer(container, config, [], {
        terrain: { source: "nope" },
        onError,
      });
      const map = renderer.getMap() as any;
      map.setTerrain = vi.fn();
      map.getSource = vi.fn(() => undefined);
      map.emit("load");
      await flush();
      expect(map.setTerrain).not.toHaveBeenCalled();
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('"nope"'))).toHaveLength(1);
      expect(onError).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe("update() (live documents, U4)", () => {
    const config = {
      center: [0, 0] as [number, number],
      zoom: 2,
      mapStyle: "https://example.com/style.json",
    };
    const layer = (color: string) => ({
      id: "a",
      type: "circle" as const,
      source: { type: "geojson" as const, data: { type: "FeatureCollection" as const, features: [] } },
      paint: { "circle-color": color },
    });
    const document = (color: string) => ({ config, layers: [layer(color)], sources: {}, options: {} });

    /** A loaded renderer over one layer; the simple mock reports every added layer as present. */
    async function loaded(options = {}) {
      renderer = new MapRenderer(container, config, [layer("#f00")], options);
      const map = renderer.getMap() as any;
      const present = new Set<string>();
      map.addLayer.mockImplementation((spec: { id: string }) => present.add(spec.id));
      map.getLayer.mockImplementation((id: string) => (present.has(id) ? { id } : undefined));
      map.setPaintProperty = vi.fn();
      const ready = new Promise<void>((resolve) => renderer.on("load", resolve));
      map.emit("load");
      await ready;
      return map;
    }

    it("getDocument() returns the normalized document the renderer was built with (KTD15)", () => {
      const sources = { pts: { type: "geojson" as const, data: { type: "FeatureCollection" as const, features: [] } } };
      renderer = new MapRenderer(container, config, [layer("#f00")], { title: "T", onError: () => {} }, sources);
      expect(renderer.getDocument()).toEqual({ config, layers: [layer("#f00")], sources, options: { title: "T" } });
    });

    it("applies a paint change through the engine chunk, then getDocument() returns the next document", async () => {
      const map = await loaded();
      const applied = vi.fn();
      renderer.on("update:applied", applied);
      const next = document("#0f0");
      const result = await renderer.update(next);
      expect(result.outcome).toBe("applied");
      expect(result.summary?.propertiesSet).toEqual([{ layerId: "a", property: "circle-color" }]);
      expect(map.setPaintProperty).toHaveBeenCalledWith("a", "circle-color", "#0f0");
      expect(applied).toHaveBeenCalledTimes(1);
      expect(applied.mock.calls[0][0].summary).toBe(result.summary);
      expect(renderer.getDocument()).toBe(next);
    });

    it("an unchanged document resolves applied with no operations and fires no event", async () => {
      await loaded();
      const applied = vi.fn();
      renderer.on("update:applied", applied);
      const result = await renderer.update(document("#f00"));
      expect(result.outcome).toBe("applied");
      expect(result.summary?.propertiesSet).toEqual([]);
      expect(applied).not.toHaveBeenCalled();
    });

    it("three rapid updates: the second is superseded, the third applies against the first's result, two events fire", async () => {
      const map = await loaded();
      const applied = vi.fn();
      renderer.on("update:applied", applied);
      const [first, second, third] = await Promise.all([
        renderer.update(document("#111")),
        renderer.update(document("#222")),
        renderer.update(document("#333")),
      ]);
      expect(first.outcome).toBe("applied");
      expect(second).toEqual({ outcome: "superseded" });
      expect(third.outcome).toBe("applied");
      expect(third.summary?.propertiesSet).toEqual([{ layerId: "a", property: "circle-color" }]);
      expect(applied).toHaveBeenCalledTimes(2);
      const colors = map.setPaintProperty.mock.calls.map((c: unknown[]) => c[2]);
      expect(colors).toEqual(["#111", "#333"]);
      expect(renderer.getDocument().layers[0].paint["circle-color"]).toBe("#333");
    });

    it("a mapStyle change is classified as a fallback before anything is awaited, and mutates nothing", async () => {
      const map = await loaded();
      const applied = vi.fn();
      renderer.on("update:applied", applied);
      const next = { ...document("#0f0"), config: { ...config, mapStyle: "https://example.com/other.json" } };
      // Decided before the engine chunk is awaited: update-chunk-failure.test.ts
      // proves it with the chunk failing; here, the outcome and the untouched map.
      const result = await renderer.update(next);
      expect(result).toEqual({ outcome: "fallback", summary: expect.objectContaining({ rebuild: true }) });
      expect(map.setPaintProperty).not.toHaveBeenCalled();
      expect(applied).not.toHaveBeenCalled();
      expect(renderer.getDocument().layers[0].paint["circle-color"]).toBe("#f00");
    });

    it("getDocument() returns the next document after update:applied even when a setter failed", async () => {
      const map = await loaded();
      const onError = vi.fn();
      renderer = new MapRenderer(container, config, [layer("#f00")], { onError });
      const map2 = renderer.getMap() as any;
      map2.addLayer.mockImplementation(() => undefined);
      map2.getLayer.mockImplementation(() => ({ id: "a" }));
      map2.setPaintProperty = vi.fn(() => {
        throw new Error("paint rejected");
      });
      const ready = new Promise<void>((resolve) => renderer.on("load", resolve));
      map2.emit("load");
      await ready;
      onError.mockClear();
      void map;
      const next = document("#0f0");
      const result = await renderer.update(next);
      expect(result.outcome).toBe("applied");
      expect(result.summary?.failures).toEqual([{ op: "layerSetProperty", message: "paint rejected", layerId: "a" }]);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][1]).toBe(false);
      expect(onError.mock.calls[0][2]).toEqual({ kind: "layer", layerId: "a" });
      expect(renderer.getDocument()).toBe(next);
    });

    it("an update made before the document loads waits for it", async () => {
      renderer = new MapRenderer(container, config, [layer("#f00")]);
      const map = renderer.getMap() as any;
      const present = new Set<string>();
      map.addLayer.mockImplementation((spec: { id: string }) => present.add(spec.id));
      map.getLayer.mockImplementation((id: string) => (present.has(id) ? { id } : undefined));
      map.setPaintProperty = vi.fn();
      const pending = renderer.update(document("#0f0"));
      let settled = false;
      void pending.then(() => (settled = true));
      await new Promise((r) => setTimeout(r, 10));
      expect(settled).toBe(false);
      map.emit("load");
      const result = await pending;
      expect(result.outcome).toBe("applied");
      expect(map.setPaintProperty).toHaveBeenCalledWith("a", "circle-color", "#0f0");
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

/** A map double whose style keeps layer order and its sources, as MapLibre does, starting from `basemap`. */
function liveStyle(map: any, basemap: string[]): { order: string[] } {
  const order: string[] = [...basemap];
  const sources: Record<string, unknown> = {};
  map.addSource.mockImplementation((id: string, spec: any) => {
    sources[id] = { ...spec, setData: vi.fn() };
  });
  map.getSource.mockImplementation((id: string) => sources[id]);
  map.addLayer.mockImplementation((spec: any, before?: string) => {
    const at = before ? order.indexOf(before) : -1;
    if (at >= 0) order.splice(at, 0, spec.id);
    else order.push(spec.id);
  });
  map.getLayer.mockImplementation((id: string) => (order.includes(id) ? { id } : undefined));
  map.moveLayer = vi.fn((id: string, before?: string) => {
    order.splice(order.indexOf(id), 1);
    const at = before ? order.indexOf(before) : -1;
    if (at >= 0) order.splice(at, 0, id);
    else order.push(id);
  });
  map.getStyle = () => ({ layers: order.map((id) => ({ id })) });
  return { order };
}

describe("first-render ordering: pinned anchors and the apply order of moves (KTD3 review sweep)", () => {
  const EMPTY = { type: "FeatureCollection", features: [] } as const;
  const config = { center: [0, 0] as [number, number], zoom: 2, mapStyle: "https://example.com/style.json" };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("three url layers whose fetches answer in reverse order end in document order: the moves are applied last to first", async () => {
    const pending = new Map<string, (result: unknown) => void>();
    const fetcher = { fetch: vi.fn((url: string) => new Promise((resolve) => pending.set(url, resolve))) };
    const layer = (id: string) => ({ id, type: "circle", source: { type: "geojson", url: `/${id}.geojson` } }) as any;
    const renderer = new MapRenderer(container, config, [layer("a"), layer("b"), layer("c")], { sourceData: { fetcher: fetcher as never } });
    const map = renderer.getMap() as any;
    const { order } = liveStyle(map, ["land"]);
    const loaded = new Promise<void>((resolve) => renderer.on("load", () => resolve()));
    map.emit("load");
    await tick();
    expect([...pending.keys()]).toEqual(["/a.geojson", "/b.geojson", "/c.geojson"]);
    for (const id of ["c", "b", "a"]) {
      pending.get(`/${id}.geojson`)!({ data: EMPTY, fromCache: false, featureCount: 0, duration: 0 });
      await tick();
    }
    await loaded;
    expect(order).toEqual(["land", "a", "b", "c"]);
    renderer.destroy();
  });

  it("a layer pinned by before: to a basemap layer stays there; the unpinned layers around it keep document order on top (the Protomaps fixture)", () => {
    const basemap = ["background", "earth", "places_subplace", "places_country"];
    const pinned = { id: "under-labels", before: "places_subplace" } as any;
    const dot = { id: "pier-dot" } as any;
    const landed = ["background", "earth", "under-labels", "places_subplace", "places_country", "pier-dot"];
    // Parallel adds put each where it belongs, in either document order: nothing to move.
    expect(documentOrderMoves([dot, pinned], landed)).toEqual([]);
    expect(documentOrderMoves([pinned, dot], landed)).toEqual([]);
    // The pinned layer landed on top (its anchor arrived late): back below its anchor; the dot stays on top.
    expect(documentOrderMoves([pinned, dot], [...basemap, "pier-dot", "under-labels"])).toEqual([{ layerId: "under-labels", beforeId: "places_subplace" }]);
    expect(documentOrderMoves([dot, pinned], [...basemap, "under-labels", "pier-dot"])).toEqual([{ layerId: "under-labels", beforeId: "places_subplace" }]);
    // The anchor is not on the map (a typo, an update's applied order): nothing to place against.
    expect(documentOrderMoves([pinned, dot], ["pier-dot", "under-labels"])).toEqual([]);
    // Two layers pinned to the same anchor keep document order below it.
    const two = [{ id: "p1", before: "water" }, { id: "p2", before: "water" }, { id: "c" }] as any;
    expect(documentOrderMoves(two, ["land", "p2", "p1", "water", "c"])).toEqual([{ layerId: "p1", beforeId: "p2" }]);
    expect(beforeIdOf(two, 0)).toBe("p2");
    expect(beforeIdOf(two, 1)).toBe("water");
    expect(beforeIdOf(two, 2)).toBeUndefined();
    expect(beforeIdOf([dot, pinned], 0)).toBeUndefined();
  });

  it("over a basemap, one unanchored layer then one anchored (and the reverse): the anchored sits below its anchor, the other on top", async () => {
    const basemap = ["background", "earth", "places_subplace", "places_country"];
    const inline = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "circle", source: { type: "geojson", data: EMPTY }, ...extra }) as any;
    for (const layers of [
      [inline("pier-dot"), inline("under-labels", { before: "places_subplace" })],
      [inline("under-labels", { before: "places_subplace" }), inline("pier-dot")],
    ]) {
      const renderer = new MapRenderer(container, config, layers, {});
      const map = renderer.getMap() as any;
      const { order } = liveStyle(map, basemap);
      const loaded = new Promise<void>((resolve) => renderer.on("load", () => resolve()));
      map.emit("load");
      await loaded;
      expect(order[order.length - 1]).toBe("pier-dot");
      expect(order.indexOf("under-labels")).toBe(order.indexOf("places_subplace") - 1);
      renderer.destroy();
    }
  });
});

describe("host chrome under a swap (deferChrome, KTD8)", () => {
  const config = { center: [0, 0] as [number, number], zoom: 2, mapStyle: "https://example.com/style.json" };

  /** A loaded renderer over no layers, its host chrome elements sitting in `corner` (the old map's). */
  async function swapRenderer(corner: HTMLElement, container: HTMLElement, deferChrome: boolean) {
    const element = document.createElement("div");
    const legend = document.createElement("div");
    corner.append(element, legend);
    const renderer = new MapRenderer(container, config, [], {
      ...(deferChrome ? { deferChrome } : {}),
      chrome: [{ position: "top-right", element }],
      legendElement: legend,
    });
    const loaded = new Promise<void>((resolve) => renderer.on("load", () => resolve()));
    (renderer.getMap() as any).emit("load");
    await loaded;
    return { renderer, element, legend };
  }

  it("stays where it is at style load and moves at mountHostChrome(); without the flag it mounts at style load", async () => {
    const corner = document.createElement("div");
    document.body.appendChild(corner);
    const container = document.createElement("div"); // off the page, as a swap's map is
    const { renderer, element, legend } = await swapRenderer(corner, container, true);
    expect(element.parentElement).toBe(corner);
    expect(legend.parentElement).toBe(corner);
    renderer.mountHostChrome();
    expect(element.closest(".ml-map-chrome-top-right")?.parentElement).toBe(container);
    expect(legend.closest(".ml-map-chrome-top-left")?.parentElement).toBe(container);
    renderer.mountHostChrome(); // once
    expect(container.querySelectorAll(".ml-map-chrome-top-right").length).toBe(1);
    renderer.destroy();

    const direct = await swapRenderer(corner, container, false);
    expect(direct.element.closest(".ml-map-chrome-top-right")?.parentElement).toBe(container);
    direct.renderer.destroy();
  });

  it("a swap that never commits (destroyed before mounting) loses nothing from the old map", async () => {
    const corner = document.createElement("div");
    document.body.appendChild(corner);
    const { renderer, element, legend } = await swapRenderer(corner, document.createElement("div"), true);
    renderer.destroy();
    expect(element.parentElement).toBe(corner);
    expect(legend.parentElement).toBe(corner);
    renderer.mountHostChrome(); // after destroy: nothing
    expect(element.parentElement).toBe(corner);
  });
});

describe("the applied document is the document as written (KTD1 review sweep)", () => {
  it("a fitTo prefetch's prefetchedData (a source in sourceData.pending) is left out; a document's own stays", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const data = { type: "FeatureCollection", features: [] };
    const renderer = new MapRenderer(
      container,
      { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" },
      [],
      { sourceData: { pending: { pts: Promise.resolve(data as never) } } },
      {
        pts: { type: "geojson", url: "/pts.geojson", prefetchedData: data } as any,
        own: { type: "geojson", url: "/own.geojson", prefetchedData: data } as any,
      }
    );
    expect(renderer.getDocument().sources.pts).toEqual({ type: "geojson", url: "/pts.geojson" });
    expect(renderer.getDocument().sources.own).toHaveProperty("prefetchedData");
    renderer.destroy();
  });
});
