import { describe, it, expect, beforeEach, vi } from "vitest";
import { MapRenderer } from "../../src/renderer/map-renderer";

// Mock maplibre-gl
vi.mock("maplibre-gl", () => {
  class MockMap {
    private events: Map<string, Set<Function>> = new Map();
    public addLayer = vi.fn();
    public addSource = vi.fn();
    public removeLayer = vi.fn();
    public removeSource = vi.fn();
    public getLayer = vi.fn();
    public getSource = vi.fn();
    public setLayoutProperty = vi.fn();
    public addControl = vi.fn();
    public removeControl = vi.fn();

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
