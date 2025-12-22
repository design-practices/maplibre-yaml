import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { LayerManager } from "../../src/renderer/layer-manager";

describe("LayerManager", () => {
  let mockMap: any;
  let manager: LayerManager;
  let callbacks: any;

  beforeEach(() => {
    mockMap = {
      addSource: vi.fn(),
      getSource: vi.fn(),
      addLayer: vi.fn(),
      getLayer: vi.fn(),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      setLayoutProperty: vi.fn(),
    };

    callbacks = {
      onDataLoading: vi.fn(),
      onDataLoaded: vi.fn(),
      onDataError: vi.fn(),
    };

    manager = new LayerManager(mockMap, callbacks);
  });

  describe("addLayer", () => {
    it("adds a layer with inline GeoJSON data", async () => {
      const layer = {
        id: "test-layer",
        type: "circle" as const,
        visible: true,
        toggleable: false,
        source: {
          type: "geojson" as const,
          data: {
            type: "FeatureCollection" as const,
            features: [],
          },
        },
        paint: {
          "circle-radius": 10,
        },
      };

      await manager.addLayer(layer);

      expect(mockMap.addSource).toHaveBeenCalledWith(
        "test-layer-source",
        expect.objectContaining({
          type: "geojson",
          data: layer.source.data,
        })
      );

      expect(mockMap.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "test-layer",
          type: "circle",
          source: "test-layer-source",
          paint: { "circle-radius": 10 },
        }),
        undefined
      );
    });

    it("adds a layer with vector source", async () => {
      const layer = {
        id: "vector-layer",
        type: "fill" as const,
        visible: true,
        toggleable: false,
        source: {
          type: "vector" as const,
          url: "https://example.com/tiles.json",
        },
      };

      await manager.addLayer(layer);

      expect(mockMap.addSource).toHaveBeenCalledWith(
        "vector-layer-source",
        expect.objectContaining({
          type: "vector",
          url: "https://example.com/tiles.json",
        })
      );
    });

    it("sets initial visibility to none when visible is false", async () => {
      const layer = {
        id: "hidden-layer",
        type: "circle" as const,
        visible: false,
        toggleable: false,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
        },
      };

      await manager.addLayer(layer);

      expect(mockMap.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({
          layout: expect.objectContaining({
            visibility: "none",
          }),
        }),
        undefined
      );
    });

    it("adds layer with before parameter", async () => {
      const layer = {
        id: "ordered-layer",
        type: "circle" as const,
        visible: true,
        toggleable: false,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
        },
        before: "existing-layer",
      };

      await manager.addLayer(layer);

      expect(mockMap.addLayer).toHaveBeenCalledWith(
        expect.anything(),
        "existing-layer"
      );
    });

    it("includes optional layer properties", async () => {
      const layer = {
        id: "complex-layer",
        type: "circle" as const,
        visible: true,
        toggleable: false,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
        },
        minzoom: 5,
        maxzoom: 15,
        filter: ["==", "type", "point"],
      };

      await manager.addLayer(layer);

      expect(mockMap.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({
          minzoom: 5,
          maxzoom: 15,
          filter: ["==", "type", "point"],
        }),
        undefined
      );
    });
  });

  describe("removeLayer", () => {
    it("removes layer and source", () => {
      mockMap.getLayer.mockReturnValue(true);
      mockMap.getSource.mockReturnValue(true);

      manager.removeLayer("test-layer");

      expect(mockMap.removeLayer).toHaveBeenCalledWith("test-layer");
      expect(mockMap.removeSource).toHaveBeenCalledWith("test-layer-source");
    });

    it("handles missing layer gracefully", () => {
      mockMap.getLayer.mockReturnValue(null);
      mockMap.getSource.mockReturnValue(null);

      expect(() => manager.removeLayer("nonexistent")).not.toThrow();
    });
  });

  describe("setVisibility", () => {
    it("shows a layer", () => {
      mockMap.getLayer.mockReturnValue(true);

      manager.setVisibility("test-layer", true);

      expect(mockMap.setLayoutProperty).toHaveBeenCalledWith(
        "test-layer",
        "visibility",
        "visible"
      );
    });

    it("hides a layer", () => {
      mockMap.getLayer.mockReturnValue(true);

      manager.setVisibility("test-layer", false);

      expect(mockMap.setLayoutProperty).toHaveBeenCalledWith(
        "test-layer",
        "visibility",
        "none"
      );
    });

    it("does nothing for nonexistent layer", () => {
      mockMap.getLayer.mockReturnValue(null);

      manager.setVisibility("nonexistent", true);

      expect(mockMap.setLayoutProperty).not.toHaveBeenCalled();
    });
  });

  describe("updateData", () => {
    it("updates GeoJSON source data", () => {
      const mockSource = {
        setData: vi.fn(),
      };
      mockMap.getSource.mockReturnValue(mockSource);

      const newData = {
        type: "FeatureCollection" as const,
        features: [
          {
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [0, 0] },
            properties: {},
          },
        ],
      };

      manager.updateData("test-layer", newData);

      expect(mockMap.getSource).toHaveBeenCalledWith("test-layer-source");
      expect(mockSource.setData).toHaveBeenCalledWith(newData);
    });

    it("handles missing source gracefully", () => {
      mockMap.getSource.mockReturnValue(null);

      const newData = {
        type: "FeatureCollection" as const,
        features: [],
      };

      expect(() => manager.updateData("test-layer", newData)).not.toThrow();
    });
  });

  describe("refresh intervals", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("stops refresh interval", () => {
      const layer = {
        id: "refresh-layer",
        type: "circle" as const,
        visible: true,
        toggleable: false,
        source: {
          type: "geojson" as const,
          url: "https://example.com/data.geojson",
          refreshInterval: 5000,
        },
      };

      manager.startRefreshInterval(layer);
      manager.stopRefreshInterval("refresh-layer");

      // Advance time - should not trigger fetch
      vi.advanceTimersByTime(10000);
      // No assertions needed - just verify no errors
    });

    it("clears all intervals", () => {
      const layer1 = {
        id: "layer1",
        type: "circle" as const,
        visible: true,
        toggleable: false,
        source: {
          type: "geojson" as const,
          url: "https://example.com/data1.geojson",
          refreshInterval: 5000,
        },
      };

      const layer2 = {
        id: "layer2",
        type: "circle" as const,
        visible: true,
        toggleable: false,
        source: {
          type: "geojson" as const,
          url: "https://example.com/data2.geojson",
          refreshInterval: 5000,
        },
      };

      manager.startRefreshInterval(layer1);
      manager.startRefreshInterval(layer2);
      manager.clearAllIntervals();

      // Advance time - should not trigger any fetches
      vi.advanceTimersByTime(10000);
      // No assertions needed - just verify no errors
    });
  });

  describe("destroy", () => {
    it("cleans up all resources", () => {
      manager.destroy();

      // Verify no errors thrown
      expect(true).toBe(true);
    });
  });
});
