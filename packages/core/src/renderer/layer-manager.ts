/**
 * @file Layer manager for MapLibre map layers
 * @module @maplibre-yaml/core/renderer
 */

import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";
import type { z } from "zod";
import type { FeatureCollection } from "geojson";
import {
  LayerSchema,
  GeoJSONSourceSchema,
  VectorSourceSchema,
  RasterSourceSchema,
  ImageSourceSchema,
  VideoSourceSchema,
} from "../schemas";
import { DataFetcher } from "../data/data-fetcher";
import { PollingManager } from "../data/polling-manager";
import { StreamManager } from "../data/streaming/stream-manager";
import { DataMerger } from "../data/merge/data-merger";
import { LoadingManager } from "../ui/loading-manager";
import type { MergeStrategy } from "../data/merge/data-merger";

type Layer = z.infer<typeof LayerSchema>;
type GeoJSONSourceConfig = z.infer<typeof GeoJSONSourceSchema>;
type VectorSourceConfig = z.infer<typeof VectorSourceSchema>;
type RasterSourceConfig = z.infer<typeof RasterSourceSchema>;
type ImageSourceConfig = z.infer<typeof ImageSourceSchema>;
type VideoSourceConfig = z.infer<typeof VideoSourceSchema>;

/**
 * Callbacks for layer data loading events
 */
export interface LayerManagerCallbacks {
  onDataLoading?: (layerId: string) => void;
  onDataLoaded?: (layerId: string, featureCount: number) => void;
  onDataError?: (layerId: string, error: Error) => void;
}

/**
 * Manages map layers and their data sources
 */
export class LayerManager {
  private map: MapLibreMap;
  private callbacks: LayerManagerCallbacks;
  private dataFetcher: DataFetcher;
  private pollingManager: PollingManager;
  private streamManager: StreamManager;
  private dataMerger: DataMerger;
  private loadingManager: LoadingManager;
  private sourceData: Map<string, FeatureCollection>;
  private layerToSource: Map<string, string>;

  // Legacy support (deprecated)
  private refreshIntervals: Map<string, NodeJS.Timeout>;
  private abortControllers: Map<string, AbortController>;

  constructor(map: MapLibreMap, callbacks?: LayerManagerCallbacks) {
    this.map = map;
    this.callbacks = callbacks || {};
    this.dataFetcher = new DataFetcher();
    this.pollingManager = new PollingManager();
    this.streamManager = new StreamManager();
    this.dataMerger = new DataMerger();
    this.loadingManager = new LoadingManager({ showUI: false });
    this.sourceData = new Map();
    this.layerToSource = new Map();

    // Legacy support
    this.refreshIntervals = new Map();
    this.abortControllers = new Map();
  }

  async addLayer(layer: Layer): Promise<void> {
    const sourceId = `${layer.id}-source`;
    this.layerToSource.set(layer.id, sourceId);
    await this.addSource(sourceId, layer);

    const layerSpec: any = {
      id: layer.id,
      type: layer.type,
      source: sourceId,
    };

    if ("paint" in layer && layer.paint) layerSpec.paint = layer.paint;
    if ("layout" in layer && layer.layout) layerSpec.layout = layer.layout;
    if ("source-layer" in layer && layer["source-layer"])
      layerSpec["source-layer"] = layer["source-layer"];
    if (layer.minzoom !== undefined) layerSpec.minzoom = layer.minzoom;
    if (layer.maxzoom !== undefined) layerSpec.maxzoom = layer.maxzoom;
    if (layer.filter) layerSpec.filter = layer.filter;

    if (layer.visible === false) {
      layerSpec.layout = layerSpec.layout || {};
      layerSpec.layout.visibility = "none";
    }

    this.map.addLayer(layerSpec, layer.before as string | undefined);

    // Check if this is a GeoJSON source with refresh interval (legacy or new config)
    if (typeof layer.source === "object" && layer.source !== null) {
      const sourceObj = layer.source as GeoJSONSourceConfig;
      if (sourceObj.type === "geojson") {
        // Use new refresh config if available, otherwise fall back to legacy
        if (sourceObj.refresh || sourceObj.refreshInterval) {
          await this.setupDataUpdates(layer.id, sourceId, sourceObj);
        }
      }
    }
  }

  private async addSource(sourceId: string, layer: Layer): Promise<void> {
    // Handle source reference (string ID)
    if (typeof layer.source === "string") {
      if (!this.map.getSource(layer.source)) {
        throw new Error(`Source reference '${layer.source}' not found`);
      }
      return;
    }

    // layer.source is now guaranteed to be an object
    const source = layer.source as { type: string };

    if (source.type === "geojson") {
      const geojsonSource = source as unknown as GeoJSONSourceConfig;

      if (geojsonSource.url) {
        await this.addGeoJSONSourceFromURL(sourceId, layer.id, geojsonSource);
      } else if (geojsonSource.data) {
        const sourceSpec: any = {
          type: "geojson",
          data: geojsonSource.data,
        };

        // Only add clustering properties if they are defined
        if (geojsonSource.cluster !== undefined) sourceSpec.cluster = geojsonSource.cluster;
        if (geojsonSource.clusterRadius !== undefined) sourceSpec.clusterRadius = geojsonSource.clusterRadius;
        if (geojsonSource.clusterMaxZoom !== undefined) sourceSpec.clusterMaxZoom = geojsonSource.clusterMaxZoom;
        if (geojsonSource.clusterMinPoints !== undefined) sourceSpec.clusterMinPoints = geojsonSource.clusterMinPoints;
        if (geojsonSource.clusterProperties !== undefined) sourceSpec.clusterProperties = geojsonSource.clusterProperties;

        this.map.addSource(sourceId, sourceSpec);
      } else if (geojsonSource.stream) {
        this.map.addSource(sourceId, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
    } else if (source.type === "vector") {
      const vectorSource = source as unknown as VectorSourceConfig;
      const vectorSpec: any = { type: "vector" };
      if (vectorSource.url) vectorSpec.url = vectorSource.url;
      if (vectorSource.tiles) vectorSpec.tiles = vectorSource.tiles;
      if (vectorSource.minzoom !== undefined)
        vectorSpec.minzoom = vectorSource.minzoom;
      if (vectorSource.maxzoom !== undefined)
        vectorSpec.maxzoom = vectorSource.maxzoom;
      if (vectorSource.bounds) vectorSpec.bounds = vectorSource.bounds;
      if (vectorSource.attribution)
        vectorSpec.attribution = vectorSource.attribution;
      this.map.addSource(sourceId, vectorSpec);
    } else if (source.type === "raster") {
      const rasterSource = source as unknown as RasterSourceConfig;
      const rasterSpec: any = { type: "raster" };
      if (rasterSource.url) rasterSpec.url = rasterSource.url;
      if (rasterSource.tiles) rasterSpec.tiles = rasterSource.tiles;
      if (rasterSource.tileSize !== undefined)
        rasterSpec.tileSize = rasterSource.tileSize;
      if (rasterSource.minzoom !== undefined)
        rasterSpec.minzoom = rasterSource.minzoom;
      if (rasterSource.maxzoom !== undefined)
        rasterSpec.maxzoom = rasterSource.maxzoom;
      if (rasterSource.bounds) rasterSpec.bounds = rasterSource.bounds;
      if (rasterSource.attribution)
        rasterSpec.attribution = rasterSource.attribution;
      this.map.addSource(sourceId, rasterSpec);
    } else if (source.type === "image") {
      const imageSource = source as unknown as ImageSourceConfig;
      this.map.addSource(sourceId, {
        type: "image",
        url: imageSource.url,
        coordinates: imageSource.coordinates,
      });
    } else if (source.type === "video") {
      const videoSource = source as unknown as VideoSourceConfig;
      this.map.addSource(sourceId, {
        type: "video",
        urls: videoSource.urls,
        coordinates: videoSource.coordinates,
      });
    }
  }

  private async addGeoJSONSourceFromURL(
    sourceId: string,
    layerId: string,
    config: GeoJSONSourceConfig
  ): Promise<void> {
    // Determine initial data source
    let initialData: FeatureCollection = {
      type: "FeatureCollection",
      features: [],
    };

    if (config.prefetchedData) {
      initialData = config.prefetchedData as FeatureCollection;
    } else if (config.data) {
      initialData = config.data as FeatureCollection;
    }

    // Add source with initial data - only include clustering properties if defined
    const sourceSpec: any = {
      type: "geojson",
      data: initialData,
    };

    // Only add clustering properties if they are defined
    if (config.cluster !== undefined) sourceSpec.cluster = config.cluster;
    if (config.clusterRadius !== undefined) sourceSpec.clusterRadius = config.clusterRadius;
    if (config.clusterMaxZoom !== undefined) sourceSpec.clusterMaxZoom = config.clusterMaxZoom;
    if (config.clusterMinPoints !== undefined) sourceSpec.clusterMinPoints = config.clusterMinPoints;
    if (config.clusterProperties !== undefined) sourceSpec.clusterProperties = config.clusterProperties;

    this.map.addSource(sourceId, sourceSpec);

    this.sourceData.set(sourceId, initialData);

    // Fetch from URL if needed
    if (config.url && !config.prefetchedData) {
      this.callbacks.onDataLoading?.(layerId);

      try {
        const cacheEnabled = config.cache?.enabled ?? true;
        const cacheTTL = config.cache?.ttl;

        const result = await this.dataFetcher.fetch(config.url, {
          skipCache: !cacheEnabled,
          ttl: cacheTTL,
        });

        const data = result.data as FeatureCollection;
        this.sourceData.set(sourceId, data);

        const source = this.map.getSource(sourceId) as GeoJSONSource;
        if (source?.setData) {
          source.setData(data);
        }

        this.callbacks.onDataLoaded?.(layerId, data.features.length);
      } catch (error: any) {
        this.callbacks.onDataError?.(layerId, error);
      }
    } else if (config.prefetchedData) {
      // Emit loaded event for prefetched data
      this.callbacks.onDataLoaded?.(layerId, initialData.features.length);
    }
  }

  /**
   * Setup polling and/or streaming for a GeoJSON source
   */
  private async setupDataUpdates(
    layerId: string,
    sourceId: string,
    config: GeoJSONSourceConfig
  ): Promise<void> {
    // Setup streaming if configured
    if (config.stream) {
      const streamConfig = config.stream;
      await this.streamManager.connect(layerId, {
        type: streamConfig.type,
        url: streamConfig.url || config.url!,
        onData: (data) => {
          this.handleDataUpdate(sourceId, layerId, data, {
            strategy:
              config.refresh?.updateStrategy ||
              config.updateStrategy ||
              "replace",
            updateKey: config.refresh?.updateKey || config.updateKey,
            windowSize: config.refresh?.windowSize,
            windowDuration: config.refresh?.windowDuration,
            timestampField: config.refresh?.timestampField,
          });
        },
        onError: (error) => {
          this.callbacks.onDataError?.(layerId, error);
        },
        reconnect: {
          enabled: streamConfig.reconnect !== false,
          maxRetries: streamConfig.reconnectMaxAttempts,
          initialDelay: streamConfig.reconnectDelay,
          maxDelay: streamConfig.reconnectMaxDelay,
        },
        eventTypes: streamConfig.eventTypes,
        protocols: streamConfig.protocols,
      });
    }

    // Setup polling if configured (new refresh config or legacy refreshInterval)
    const refreshInterval =
      config.refresh?.refreshInterval || config.refreshInterval;
    if (refreshInterval && config.url) {
      const url = config.url;
      const cacheEnabled = config.cache?.enabled ?? true;
      const cacheTTL = config.cache?.ttl;

      await this.pollingManager.start(layerId, {
        interval: refreshInterval,
        onTick: async () => {
          const result = await this.dataFetcher.fetch(url, {
            skipCache: !cacheEnabled,
            ttl: cacheTTL,
          });
          this.handleDataUpdate(sourceId, layerId, result.data as FeatureCollection, {
            strategy:
              config.refresh?.updateStrategy ||
              config.updateStrategy ||
              "replace",
            updateKey: config.refresh?.updateKey || config.updateKey,
            windowSize: config.refresh?.windowSize,
            windowDuration: config.refresh?.windowDuration,
            timestampField: config.refresh?.timestampField,
          });
        },
        onError: (error) => {
          this.callbacks.onDataError?.(layerId, error);
        },
      });
    }
  }

  /**
   * Handle incoming data updates with merge strategy
   */
  private handleDataUpdate(
    sourceId: string,
    layerId: string,
    incoming: FeatureCollection,
    options: {
      strategy: MergeStrategy;
      updateKey?: string;
      windowSize?: number;
      windowDuration?: number;
      timestampField?: string;
    }
  ): void {
    const existing =
      this.sourceData.get(sourceId) || {
        type: "FeatureCollection" as const,
        features: [],
      };

    const mergeResult = this.dataMerger.merge(existing, incoming, options);
    this.sourceData.set(sourceId, mergeResult.data);

    const source = this.map.getSource(sourceId) as GeoJSONSource;
    if (source?.setData) {
      source.setData(mergeResult.data);
    }

    this.callbacks.onDataLoaded?.(layerId, mergeResult.total);
  }

  /**
   * Pause data refresh for a layer (polling)
   */
  pauseRefresh(layerId: string): void {
    this.pollingManager.pause(layerId);
  }

  /**
   * Resume data refresh for a layer (polling)
   */
  resumeRefresh(layerId: string): void {
    this.pollingManager.resume(layerId);
  }

  /**
   * Force immediate refresh for a layer (polling)
   */
  async refreshNow(layerId: string): Promise<void> {
    await this.pollingManager.triggerNow(layerId);
  }

  /**
   * Disconnect streaming connection for a layer
   */
  disconnectStream(layerId: string): void {
    this.streamManager.disconnect(layerId);
  }

  removeLayer(layerId: string): void {
    // Stop all data updates
    this.pollingManager.stop(layerId);
    this.streamManager.disconnect(layerId);
    this.loadingManager.hideLoading(layerId);

    // Legacy support
    this.stopRefreshInterval(layerId);

    const controller = this.abortControllers.get(layerId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(layerId);
    }

    if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);

    const sourceId = this.layerToSource.get(layerId) || `${layerId}-source`;
    if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);

    // Clean up data references
    this.sourceData.delete(sourceId);
    this.layerToSource.delete(layerId);
  }

  setVisibility(layerId: string, visible: boolean): void {
    if (!this.map.getLayer(layerId)) return;
    this.map.setLayoutProperty(
      layerId,
      "visibility",
      visible ? "visible" : "none"
    );
  }

  updateData(layerId: string, data: GeoJSON.GeoJSON): void {
    const sourceId = `${layerId}-source`;
    const source = this.map.getSource(sourceId) as GeoJSONSource;
    if (source && source.setData) source.setData(data as any);
  }

  /**
   * @deprecated Legacy refresh method - use PollingManager instead
   */
  startRefreshInterval(layer: Layer): void {
    // Legacy method kept for backward compatibility
    // New code should use setupDataUpdates() which is called automatically from addLayer
    if (typeof layer.source !== "object" || layer.source === null) {
      return;
    }

    const sourceObj = layer.source as {
      type: string;
      url?: string;
      refreshInterval?: number;
    };
    if (
      sourceObj.type !== "geojson" ||
      !sourceObj.url ||
      !sourceObj.refreshInterval
    ) {
      return;
    }

    const geojsonSource = layer.source as unknown as GeoJSONSourceConfig;
    const interval = setInterval(async () => {
      const sourceId = `${layer.id}-source`;
      try {
        const cacheEnabled = geojsonSource.cache?.enabled ?? true;
        const cacheTTL = geojsonSource.cache?.ttl;

        const result = await this.dataFetcher.fetch(geojsonSource.url!, {
          skipCache: !cacheEnabled,
          ttl: cacheTTL,
        });
        const data = result.data as FeatureCollection;
        this.sourceData.set(sourceId, data);

        const source = this.map.getSource(sourceId) as GeoJSONSource;
        if (source?.setData) {
          source.setData(data);
        }
        this.callbacks.onDataLoaded?.(layer.id, data.features.length);
      } catch (error: any) {
        this.callbacks.onDataError?.(layer.id, error);
      }
    }, geojsonSource.refreshInterval!);

    this.refreshIntervals.set(layer.id, interval);
  }

  stopRefreshInterval(layerId: string): void {
    const interval = this.refreshIntervals.get(layerId);
    if (interval) {
      clearInterval(interval);
      this.refreshIntervals.delete(layerId);
    }
  }

  clearAllIntervals(): void {
    for (const interval of this.refreshIntervals.values())
      clearInterval(interval);
    this.refreshIntervals.clear();
  }

  destroy(): void {
    // Clean up all data management components
    this.pollingManager.destroy();
    this.streamManager.destroy();
    this.loadingManager.destroy();

    // Clear data references
    this.sourceData.clear();
    this.layerToSource.clear();

    // Legacy cleanup
    this.clearAllIntervals();
    for (const controller of this.abortControllers.values()) controller.abort();
    this.abortControllers.clear();
  }
}
