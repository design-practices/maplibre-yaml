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

    it("wraps a literal colour in a feature-state case for hover.highlight", async () => {
      const layer = {
        id: "pts",
        type: "circle" as const,
        visible: true,
        toggleable: false,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
        },
        paint: { "circle-color": "#ff0000" },
        interactive: { hover: { highlight: true } },
      };

      await manager.addLayer(layer as any);

      // Without this, setFeatureState fires but nothing renders differently.
      const spec = mockMap.addLayer.mock.calls[0][0];
      expect(spec.paint["circle-color"]).toEqual([
        "case",
        ["boolean", ["feature-state", "hover"], false],
        expect.any(String),
        "#ff0000",
      ]);
    });

    it("leaves an authored expression untouched and warns", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const authored = ["get", "color"];
      const layer = {
        id: "pts",
        type: "circle" as const,
        visible: true,
        toggleable: false,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
        },
        paint: { "circle-color": authored },
        interactive: { hover: { highlight: true } },
      };

      await manager.addLayer(layer as any);

      // Overwriting would silently discard the author's data-driven styling.
      const spec = mockMap.addLayer.mock.calls[0][0];
      expect(spec.paint["circle-color"]).toEqual(authored);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("expression"));
      warn.mockRestore();
    });

    it("does not rewrite paint when highlight is absent", async () => {
      const layer = {
        id: "pts",
        type: "circle" as const,
        visible: true,
        toggleable: false,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
        },
        paint: { "circle-color": "#ff0000" },
      };

      await manager.addLayer(layer as any);

      const spec = mockMap.addLayer.mock.calls[0][0];
      expect(spec.paint["circle-color"]).toBe("#ff0000");
    });

    it("enables generateId with a warning when the source has no id strategy", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const layer = {
        id: "pts",
        type: "circle" as const,
        visible: true,
        toggleable: false,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
        },
        interactive: { hover: { highlight: true } },
      };

      await manager.addLayer(layer as any);

      expect(mockMap.addSource).toHaveBeenCalledWith(
        "pts-source",
        expect.objectContaining({ generateId: true })
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("generateId"));
      warn.mockRestore();
    });

    it("respects an authored promoteId instead of generating ids", async () => {
      const layer = {
        id: "pts",
        type: "circle" as const,
        visible: true,
        toggleable: false,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
          promoteId: "stationId",
        },
        interactive: { hover: { highlight: true } },
      };

      await manager.addLayer(layer as any);

      const spec = mockMap.addSource.mock.calls[0][1];
      expect(spec.promoteId).toBe("stationId");
      expect(spec.generateId).toBeUndefined();
    });

    it("throws a clear error for a $ref source instead of silently skipping (ml-tfd.8)", async () => {
      // Falling through addSource's type chain left the layer pointing at a
      // source that was never added; MapLibre then killed the document with
      // an opaque style error.
      await expect(
        manager.addLayer({
          id: "p",
          type: "circle",
          visible: true,
          toggleable: false,
          source: { $ref: "#/sources/cities" },
        } as any)
      ).rejects.toThrow(/"\$ref" reference.*"pages:" document/);
    });

    it("adds a background layer without resolving any source (ml-chf)", async () => {
      const layer = {
        id: "backdrop",
        type: "background" as const,
        visible: true,
        toggleable: false,
        paint: { "background-color": "#cfe8c9", "background-opacity": 0.8 },
      };

      // Previously this dereferenced `layer.source.type` on undefined and
      // threw — a schema-valid background layer killed the whole document.
      await manager.addLayer(layer as any);

      expect(mockMap.addSource).not.toHaveBeenCalled();
      const spec = mockMap.addLayer.mock.calls[0][0];
      expect(spec).toEqual(
        expect.objectContaining({ id: "backdrop", type: "background" })
      );
      expect(spec).not.toHaveProperty("source");
      expect(spec.paint["background-color"]).toBe("#cfe8c9");
    });

    it("removes a background layer without touching any source", async () => {
      await manager.addLayer({
        id: "backdrop",
        type: "background",
        visible: true,
        toggleable: false,
      } as any);
      mockMap.getLayer.mockReturnValue(true);
      mockMap.getSource = vi.fn(() => undefined);

      manager.removeLayer("backdrop");

      expect(mockMap.removeLayer).toHaveBeenCalledWith("backdrop");
      expect(mockMap.removeSource).not.toHaveBeenCalled();
    });

    it("adds a hillshade layer with a raster-dem source", async () => {
      const layer = {
        id: "terrain",
        type: "hillshade" as const,
        visible: true,
        toggleable: false,
        source: {
          type: "raster-dem" as const,
          tiles: ["https://example.com/dem/{z}/{x}/{y}.png"],
          encoding: "terrarium" as const,
          tileSize: 256,
        },
      };

      await manager.addLayer(layer as any);

      expect(mockMap.addSource).toHaveBeenCalledWith(
        "terrain-source",
        expect.objectContaining({
          type: "raster-dem",
          tiles: ["https://example.com/dem/{z}/{x}/{y}.png"],
          encoding: "terrarium",
          tileSize: 256,
        })
      );
      expect(mockMap.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ id: "terrain", type: "hillshade" }),
        undefined
      );
    });

    it("forwards every raster-dem field, including custom-encoding factors", async () => {
      const layer = {
        id: "terrain",
        type: "hillshade" as const,
        visible: true,
        toggleable: false,
        source: {
          type: "raster-dem" as const,
          url: "https://example.com/terrain.json",
          encoding: "custom" as const,
          redFactor: 256,
          greenFactor: 1,
          blueFactor: 1 / 256,
          baseShift: 32768,
          tileSize: 512,
          minzoom: 2,
          maxzoom: 14,
          bounds: [-180, -85, 180, 85],
          attribution: "© Example Terrain",
        },
      };

      await manager.addLayer(layer as any);

      // Exact equality, not objectContaining: a dropped field would make
      // `encoding: custom` decode as mapbox with no diagnostic.
      expect(mockMap.addSource).toHaveBeenCalledWith("terrain-source", {
        type: "raster-dem",
        url: "https://example.com/terrain.json",
        encoding: "custom",
        redFactor: 256,
        greenFactor: 1,
        blueFactor: 1 / 256,
        baseShift: 32768,
        tileSize: 512,
        minzoom: 2,
        maxzoom: 14,
        bounds: [-180, -85, 180, 85],
        attribution: "© Example Terrain",
      });
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

  describe("named sources (U7)", () => {
    /** A block-level named source, as `sources:` declares it. */
    const namedGeojson = (extra: Record<string, unknown> = {}) => ({
      type: "geojson" as const,
      data: { type: "FeatureCollection" as const, features: [] },
      ...extra,
    });

    it("registers a named source once for two referencing layers", async () => {
      manager.registerSources({ shared: namedGeojson() });

      expect(mockMap.addSource).toHaveBeenCalledTimes(1);
      expect(mockMap.addSource).toHaveBeenCalledWith(
        "shared",
        expect.objectContaining({ type: "geojson" })
      );
    });

    it("scrubs YAML-only keys before handing the spec to MapLibre", async () => {
      manager.registerSources({
        shared: namedGeojson({
          refresh: { refreshInterval: 5000, updateStrategy: "replace" },
          cache: { enabled: true },
          prefetchedData: { type: "FeatureCollection", features: [] },
        }),
      });

      const [, spec] = mockMap.addSource.mock.calls[0];
      // These drive our own machinery; MapLibre would reject or ignore them.
      expect(spec).not.toHaveProperty("refresh");
      expect(spec).not.toHaveProperty("cache");
      expect(spec).not.toHaveProperty("prefetchedData");
      expect(spec).toHaveProperty("data");
    });

    it("updateData reaches a named source, not a derived one", async () => {
      manager.registerSources({ shared: namedGeojson() });
      const setData = vi.fn();
      mockMap.getSource = vi.fn((id: string) =>
        id === "shared" ? { setData } : undefined
      );

      await manager.addLayer({
        id: "a",
        type: "circle",
        visible: true,
        toggleable: false,
        source: "shared",
      } as any);

      const next = { type: "FeatureCollection", features: [] } as any;
      manager.updateData("a", next);

      // Previously resolved `a-source`, which does not exist for a named
      // source, so the update silently did nothing.
      expect(setData).toHaveBeenCalledWith(next);
    });

    it("updating through one layer is visible to its siblings on the same source", async () => {
      manager.registerSources({ shared: namedGeojson() });
      const setData = vi.fn();
      mockMap.getSource = vi.fn((id: string) =>
        id === "shared" ? { setData } : undefined
      );

      for (const id of ["a", "b"]) {
        await manager.addLayer({
          id,
          type: "circle",
          visible: true,
          toggleable: false,
          source: "shared",
        } as any);
      }

      manager.updateData("a", { type: "FeatureCollection", features: [] } as any);

      // One source backs both layers, so one setData serves both. Documented
      // behaviour, not an accident.
      expect(setData).toHaveBeenCalledTimes(1);
      expect(manager.getSourceIdForLayer("b")).toBe("shared");
    });

    it("stops polling only when the last referencing layer is removed", async () => {
      manager.registerSources({
        shared: namedGeojson({
          url: "https://example.com/d.geojson",
          refresh: { refreshInterval: 5000, updateStrategy: "replace" },
        }),
      });
      mockMap.getSource = vi.fn(() => ({ setData: vi.fn() }));

      for (const id of ["a", "b"]) {
        await manager.addLayer({
          id,
          type: "circle",
          visible: true,
          toggleable: false,
          source: "shared",
        } as any);
      }

      expect(manager.isRefreshing("shared")).toBe(true);
      manager.removeLayer("a");
      expect(manager.isRefreshing("shared")).toBe(true); // b still needs it
      manager.removeLayer("b");
      expect(manager.isRefreshing("shared")).toBe(false);
    });

    // `url` is our key, not MapLibre's — a geojson source spec carrying it
    // fails style validation and aborted the whole render. The named path
    // must route through the DataFetcher like inline layer sources do.
    describe("named source with url", () => {
      const remoteFC = {
        type: "FeatureCollection" as const,
        features: [
          {
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [0, 0] },
            properties: { mag: 3 },
          },
        ],
      };

      const okResponse = () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        json: async () => remoteFC,
      });

      afterEach(() => {
        vi.unstubAllGlobals();
      });

      it("adds the source without the url key, with initial data and cluster options", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => okResponse()));

        manager.registerSources({
          quakes: {
            type: "geojson",
            url: "https://example.com/quakes.geojson",
            cluster: true,
            clusterRadius: 50,
          },
        });

        // The source lands synchronously so string-ref layers can attach.
        expect(mockMap.addSource).toHaveBeenCalledTimes(1);
        const [id, spec] = mockMap.addSource.mock.calls[0];
        expect(id).toBe("quakes");
        expect(spec).not.toHaveProperty("url");
        expect(spec.data).toEqual({ type: "FeatureCollection", features: [] });
        expect(spec.cluster).toBe(true);
        expect(spec.clusterRadius).toBe(50);
      });

      it("resolves the fetch into setData and fires data events keyed by the source id", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => okResponse()));
        const setData = vi.fn();

        // registerSources consults getSource BEFORE adding (idempotence
        // pre-check), so it must see nothing during registration — only the
        // later fetch resolution should find the live source.
        manager.registerSources({
          quakes: { type: "geojson", url: "https://example.com/quakes.geojson" },
        });
        mockMap.getSource = vi.fn((id: string) =>
          id === "quakes" ? { setData } : undefined
        );

        await vi.waitFor(() => {
          expect(setData).toHaveBeenCalledWith(remoteFC);
        });
        expect(callbacks.onDataLoading).toHaveBeenCalledWith("quakes");
        expect(callbacks.onDataLoaded).toHaveBeenCalledWith("quakes", 1);
      });

      it("reports a failed fetch through onDataError instead of throwing", async () => {
        vi.stubGlobal(
          "fetch",
          // 404: non-retryable per isRetryableError, so the error surfaces
          // immediately instead of after the retry backoff schedule.
          vi.fn(async () => ({
            ok: false,
            status: 404,
            statusText: "Not Found",
            headers: { get: () => null },
            json: async () => ({}),
          }))
        );

        manager.registerSources({
          quakes: { type: "geojson", url: "https://example.com/quakes.geojson" },
        });

        await vi.waitFor(() => {
          expect(callbacks.onDataError).toHaveBeenCalledWith(
            "quakes",
            expect.anything()
          );
        });
      });
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

  describe("destroy", () => {
    it("cleans up all resources", () => {
      manager.destroy();

      // Verify no errors thrown
      expect(true).toBe(true);
    });
  });
});
