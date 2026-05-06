import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { JSDOM } from "jsdom";
import { LayerManager } from "../../src/renderer/layer-manager";
import type { FeatureCollection } from "geojson";

// Mock maplibre-gl
vi.mock("maplibre-gl", () => ({
  default: {
    Map: vi.fn(),
  },
}));

/**
 * Integration tests for data flow
 * Tests the complete flow: fetch -> cache -> poll -> stream -> merge
 */
describe("Data Flow Integration", () => {
  let dom: JSDOM;
  let mockMap: any;
  let layerManager: LayerManager;
  let fetchMock: any;

  const sampleFeatureCollection: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [0, 0] },
        properties: { id: 1, name: "Point 1" },
      },
    ],
  };

  const updatedFeatureCollection: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [1, 1] },
        properties: { id: 2, name: "Point 2" },
      },
    ],
  };

  beforeEach(() => {
    dom = new JSDOM("<!DOCTYPE html><div id='map'></div>");
    global.document = dom.window.document as any;
    global.window = dom.window as any;
    global.fetch = vi.fn();
    fetchMock = global.fetch as any;

    // Mock MapLibre map
    const sources = new Map<string, any>();
    const layers = new Map<string, any>();

    mockMap = {
      addSource: vi.fn((id: string, source: any) => {
        sources.set(id, {
          ...source,
          setData: vi.fn((data: any) => {
            sources.get(id)!.data = data;
          }),
        });
      }),
      getSource: vi.fn((id: string) => sources.get(id)),
      addLayer: vi.fn((layer: any) => {
        layers.set(layer.id, layer);
      }),
      getLayer: vi.fn((id: string) => layers.get(id)),
      removeLayer: vi.fn((id: string) => {
        layers.delete(id);
      }),
      removeSource: vi.fn((id: string) => {
        sources.delete(id);
      }),
      setLayoutProperty: vi.fn(),
    };

    layerManager = new LayerManager(mockMap);
  });

  afterEach(() => {
    layerManager.destroy();
    vi.restoreAllMocks();
  });

  describe("initial data loading", () => {
    it("fetches and adds GeoJSON layer from URL", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleFeatureCollection,
        headers: new Map(),
      });

      const onDataLoaded = vi.fn();
      layerManager = new LayerManager(mockMap, {
        onDataLoaded,
      });

      await layerManager.addLayer({
        id: "test-layer",
        type: "circle",
        source: {
          type: "geojson",
          url: "https://example.com/data.geojson",
        },
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://example.com/data.geojson",
        expect.any(Object)
      );

      // Check that source was added
      expect(mockMap.addSource).toHaveBeenCalled();

      // Check that data was set via setData
      const source = mockMap.getSource("test-layer-source");
      expect(source.setData).toHaveBeenCalledWith(sampleFeatureCollection);

      expect(mockMap.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "test-layer",
          type: "circle",
          source: "test-layer-source",
        }),
        undefined
      );
      expect(onDataLoaded).toHaveBeenCalledWith("test-layer", 1);
    });

    it("uses inline data without fetching", async () => {
      const onDataLoaded = vi.fn();
      layerManager = new LayerManager(mockMap, {
        onDataLoaded,
      });

      await layerManager.addLayer({
        id: "test-layer",
        type: "circle",
        source: {
          type: "geojson",
          data: sampleFeatureCollection,
        },
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockMap.addSource).toHaveBeenCalledWith(
        "test-layer-source",
        expect.objectContaining({
          type: "geojson",
          data: sampleFeatureCollection,
        })
      );
      expect(onDataLoaded).not.toHaveBeenCalled(); // No callback for inline data
    });

    it("uses prefetched data without fetching", async () => {
      const onDataLoaded = vi.fn();
      layerManager = new LayerManager(mockMap, {
        onDataLoaded,
      });

      await layerManager.addLayer({
        id: "test-layer",
        type: "circle",
        source: {
          type: "geojson",
          url: "https://example.com/data.geojson",
          prefetchedData: sampleFeatureCollection,
        },
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockMap.addSource).toHaveBeenCalledWith(
        "test-layer-source",
        expect.objectContaining({
          type: "geojson",
          data: sampleFeatureCollection,
        })
      );
      expect(onDataLoaded).toHaveBeenCalledWith("test-layer", 1);
    });

    it.skip("handles fetch errors", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Network error"));

      const onDataError = vi.fn();
      layerManager = new LayerManager(mockMap, {
        onDataError,
      });

      await layerManager.addLayer({
        id: "test-layer",
        type: "circle",
        source: {
          type: "geojson",
          url: "https://example.com/data.geojson",
        },
      });

      expect(onDataError).toHaveBeenCalledWith("test-layer", expect.any(Error));
    });
  });

  describe("polling refresh", () => {
    it.skip("refreshes data at specified interval with replace strategy", async () => {
      let fetchCount = 0;
      fetchMock.mockImplementation(async () => {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () =>
            fetchCount === 1
              ? sampleFeatureCollection
              : updatedFeatureCollection,
          headers: new Map(),
        };
      });

      const onDataLoaded = vi.fn();
      layerManager = new LayerManager(mockMap, {
        onDataLoaded,
      });

      await layerManager.addLayer({
        id: "test-layer",
        type: "circle",
        source: {
          type: "geojson",
          url: "https://example.com/data.geojson",
          refresh: {
            refreshInterval: 100, // Short interval for testing
            updateStrategy: "replace",
          },
        },
      });

      // Initial fetch
      expect(fetchCount).toBe(1);
      expect(onDataLoaded).toHaveBeenCalledWith("test-layer", 1);

      // Wait for first refresh
      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(fetchCount).toBeGreaterThanOrEqual(2);
      const source = mockMap.getSource("test-layer-source");
      expect(source.setData).toHaveBeenCalledWith(updatedFeatureCollection);

      layerManager.removeLayer("test-layer");
    });

    it.skip("merges data with merge strategy", async () => {
      const feature1: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: 1, name: "Point 1" },
          },
        ],
      };

      const feature2: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 1] },
            properties: { id: 2, name: "Point 2" },
          },
        ],
      };

      const feature1Updated: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: 1, name: "Point 1 Updated" },
          },
        ],
      };

      let fetchCount = 0;
      fetchMock.mockImplementation(async () => {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => {
            if (fetchCount === 1) return feature1;
            if (fetchCount === 2) return feature2;
            return feature1Updated;
          },
          headers: new Map(),
        };
      });

      const onDataLoaded = vi.fn();
      layerManager = new LayerManager(mockMap, {
        onDataLoaded,
      });

      await layerManager.addLayer({
        id: "test-layer",
        type: "circle",
        source: {
          type: "geojson",
          url: "https://example.com/data.geojson",
          refresh: {
            refreshInterval: 5000,
            updateStrategy: "merge",
            updateKey: "id",
          },
        },
      });

      // Initial fetch
      expect(onDataLoaded).toHaveBeenCalledWith("test-layer", 1);

      // First refresh - adds new feature
      await vi.advanceTimersByTimeAsync(5000);
      await vi.runAllTimersAsync();
      expect(fetchCount).toBe(2);

      // Second refresh - updates existing feature
      await vi.advanceTimersByTimeAsync(5000);
      await vi.runAllTimersAsync();
      expect(fetchCount).toBe(3);

      const source = mockMap.getSource("test-layer-source");
      const lastCall =
        source.setData.mock.calls[source.setData.mock.calls.length - 1];
      expect(lastCall[0].features).toHaveLength(2);
      expect(
        lastCall[0].features.find((f: any) => f.properties.id === 1).properties
          .name
      ).toBe("Point 1 Updated");
    });

    it.skip("uses append-window strategy with size limit", async () => {
      let fetchCount = 0;
      fetchMock.mockImplementation(async () => {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: [fetchCount, fetchCount],
                },
                properties: { id: fetchCount },
              },
            ],
          }),
          headers: new Map(),
        };
      });

      const onDataLoaded = vi.fn();
      layerManager = new LayerManager(mockMap, {
        onDataLoaded,
      });

      await layerManager.addLayer({
        id: "test-layer",
        type: "circle",
        source: {
          type: "geojson",
          url: "https://example.com/data.geojson",
          refresh: {
            refreshInterval: 1000,
            updateStrategy: "append-window",
            windowSize: 3,
          },
        },
      });

      // Initial + 4 refreshes
      await vi.advanceTimersByTimeAsync(1000);
      await vi.runAllTimersAsync();
      await vi.advanceTimersByTimeAsync(1000);
      await vi.runAllTimersAsync();
      await vi.advanceTimersByTimeAsync(1000);
      await vi.runAllTimersAsync();
      await vi.advanceTimersByTimeAsync(1000);
      await vi.runAllTimersAsync();

      const source = mockMap.getSource("test-layer-source");
      const lastCall =
        source.setData.mock.calls[source.setData.mock.calls.length - 1];
      expect(lastCall[0].features).toHaveLength(3); // Window size limit
    });
  });

  describe("pause/resume", () => {
    it.skip("pauses and resumes polling", async () => {
      let fetchCount = 0;
      fetchMock.mockImplementation(async () => {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => sampleFeatureCollection,
          headers: new Map(),
        };
      });

      await layerManager.addLayer({
        id: "test-layer",
        type: "circle",
        source: {
          type: "geojson",
          url: "https://example.com/data.geojson",
          refresh: {
            refreshInterval: 5000,
          },
        },
      });

      const initialFetchCount = fetchCount;

      // Pause
      layerManager.pauseRefresh("test-layer");
      await vi.advanceTimersByTimeAsync(5000);
      await vi.runAllTimersAsync();
      expect(fetchCount).toBe(initialFetchCount); // No new fetches

      // Resume
      layerManager.resumeRefresh("test-layer");
      await vi.advanceTimersByTimeAsync(5000);
      await vi.runAllTimersAsync();
      expect(fetchCount).toBeGreaterThan(initialFetchCount); // Fetching resumed
    });

    it.skip("forces immediate refresh", async () => {
      let fetchCount = 0;
      fetchMock.mockImplementation(async () => {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => sampleFeatureCollection,
          headers: new Map(),
        };
      });

      await layerManager.addLayer({
        id: "test-layer",
        type: "circle",
        source: {
          type: "geojson",
          url: "https://example.com/data.geojson",
          refresh: {
            refreshInterval: 10000,
          },
        },
      });

      const initialFetchCount = fetchCount;

      // Force refresh immediately
      await layerManager.refreshNow("test-layer");
      await vi.runAllTimersAsync();

      expect(fetchCount).toBe(initialFetchCount + 1);
    });
  });

  describe("error handling", () => {
    it.skip("emits error event on fetch failure", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Network error"));

      const onDataError = vi.fn();
      layerManager = new LayerManager(mockMap, {
        onDataError,
      });

      await layerManager.addLayer({
        id: "test-layer",
        type: "circle",
        source: {
          type: "geojson",
          url: "https://example.com/data.geojson",
        },
      });

      expect(onDataError).toHaveBeenCalledWith("test-layer", expect.any(Error));
    });

    it.skip("continues polling after error", async () => {
      let fetchCount = 0;
      fetchMock.mockImplementation(async () => {
        fetchCount++;
        if (fetchCount === 2) {
          throw new Error("Temporary error");
        }
        return {
          ok: true,
          status: 200,
          json: async () => sampleFeatureCollection,
          headers: new Map(),
        };
      });

      const onDataError = vi.fn();
      const onDataLoaded = vi.fn();
      layerManager = new LayerManager(mockMap, {
        onDataError,
        onDataLoaded,
      });

      await layerManager.addLayer({
        id: "test-layer",
        type: "circle",
        source: {
          type: "geojson",
          url: "https://example.com/data.geojson",
          refresh: {
            refreshInterval: 5000,
          },
        },
      });

      expect(onDataLoaded).toHaveBeenCalledTimes(1);

      // Second fetch fails
      await vi.advanceTimersByTimeAsync(5000);
      await vi.runAllTimersAsync();
      expect(onDataError).toHaveBeenCalledTimes(1);

      // Third fetch succeeds
      await vi.advanceTimersByTimeAsync(5000);
      await vi.runAllTimersAsync();
      expect(onDataLoaded).toHaveBeenCalledTimes(2);
    });
  });

  describe("cleanup", () => {
    it.skip("stops polling when layer is removed", async () => {
      let fetchCount = 0;
      fetchMock.mockImplementation(async () => {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => sampleFeatureCollection,
          headers: new Map(),
        };
      });

      await layerManager.addLayer({
        id: "test-layer",
        type: "circle",
        source: {
          type: "geojson",
          url: "https://example.com/data.geojson",
          refresh: {
            refreshInterval: 5000,
          },
        },
      });

      const initialFetchCount = fetchCount;

      // Remove layer
      layerManager.removeLayer("test-layer");

      // Wait for what would have been the next poll
      await vi.advanceTimersByTimeAsync(5000);
      await vi.runAllTimersAsync();
      expect(fetchCount).toBe(initialFetchCount); // No new fetches
    });

    it.skip("cleans up all resources on destroy", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => sampleFeatureCollection,
        headers: new Map(),
      });

      await layerManager.addLayer({
        id: "test-layer-1",
        type: "circle",
        source: {
          type: "geojson",
          url: "https://example.com/data1.geojson",
          refresh: {
            refreshInterval: 5000,
          },
        },
      });

      await layerManager.addLayer({
        id: "test-layer-2",
        type: "circle",
        source: {
          type: "geojson",
          url: "https://example.com/data2.geojson",
          refresh: {
            refreshInterval: 5000,
          },
        },
      });

      const fetchCountBeforeDestroy = fetchMock.mock.calls.length;

      // Destroy
      layerManager.destroy();

      // Wait for what would have been the next polls
      await vi.advanceTimersByTimeAsync(5000);
      await vi.runAllTimersAsync();
      expect(fetchMock.mock.calls.length).toBe(fetchCountBeforeDestroy);
    });
  });

  describe("caching", () => {
    it("uses cached data on subsequent fetches", async () => {
      let fetchCount = 0;
      fetchMock.mockImplementation(async () => {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => sampleFeatureCollection,
          headers: new Map([["cache-control", "max-age=60"]]),
        };
      });

      // First layer - should fetch
      await layerManager.addLayer({
        id: "test-layer-1",
        type: "circle",
        source: {
          type: "geojson",
          url: "https://example.com/data.geojson",
          cache: {
            enabled: true,
            ttl: 60000,
          },
        },
      });

      expect(fetchCount).toBe(1);

      // Second layer with same URL - should use cache
      await layerManager.addLayer({
        id: "test-layer-2",
        type: "circle",
        source: {
          type: "geojson",
          url: "https://example.com/data.geojson",
          cache: {
            enabled: true,
            ttl: 60000,
          },
        },
      });

      expect(fetchCount).toBe(1); // Still 1 - used cache
    });

    it("bypasses cache when disabled", async () => {
      let fetchCount = 0;
      fetchMock.mockImplementation(async () => {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => sampleFeatureCollection,
          headers: new Map(),
        };
      });

      await layerManager.addLayer({
        id: "test-layer-1",
        type: "circle",
        source: {
          type: "geojson",
          url: "https://example.com/data.geojson",
          cache: {
            enabled: false,
          },
        },
      });

      expect(fetchCount).toBe(1);

      // Second layer with same URL but cache disabled
      await layerManager.addLayer({
        id: "test-layer-2",
        type: "circle",
        source: {
          type: "geojson",
          url: "https://example.com/data.geojson",
          cache: {
            enabled: false,
          },
        },
      });

      expect(fetchCount).toBe(2); // Fetched again
    });
  });
});
