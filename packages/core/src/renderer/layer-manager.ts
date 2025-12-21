/**
 * @file Layer manager for MapLibre map layers
 * @module @maplibre-yaml/core/renderer
 */

import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import type { z } from 'zod';
import {
  LayerSchema,
  GeoJSONSourceSchema,
  VectorSourceSchema,
  RasterSourceSchema,
  ImageSourceSchema,
  VideoSourceSchema,
} from '../schemas';

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
  private refreshIntervals: Map<string, NodeJS.Timeout>;
  private abortControllers: Map<string, AbortController>;

  constructor(map: MapLibreMap, callbacks?: LayerManagerCallbacks) {
    this.map = map;
    this.callbacks = callbacks || {};
    this.refreshIntervals = new Map();
    this.abortControllers = new Map();
  }

  async addLayer(layer: Layer): Promise<void> {
    const sourceId = `${layer.id}-source`;
    await this.addSource(sourceId, layer);

    const layerSpec: any = {
      id: layer.id,
      type: layer.type,
      source: sourceId,
    };

    if ('paint' in layer && layer.paint) layerSpec.paint = layer.paint;
    if ('layout' in layer && layer.layout) layerSpec.layout = layer.layout;
    if ('source-layer' in layer && layer['source-layer']) layerSpec['source-layer'] = layer['source-layer'];
    if (layer.minzoom !== undefined) layerSpec.minzoom = layer.minzoom;
    if (layer.maxzoom !== undefined) layerSpec.maxzoom = layer.maxzoom;
    if (layer.filter) layerSpec.filter = layer.filter;

    if (layer.visible === false) {
      layerSpec.layout = layerSpec.layout || {};
      layerSpec.layout.visibility = 'none';
    }

    this.map.addLayer(layerSpec, layer.before as string | undefined);

    // Check if this is a GeoJSON source with refresh interval
    if (typeof layer.source === 'object' && layer.source !== null) {
      const sourceObj = layer.source as { type: string; refreshInterval?: number };
      if (sourceObj.type === 'geojson' && sourceObj.refreshInterval) {
        this.startRefreshInterval(layer);
      }
    }
  }

  private async addSource(sourceId: string, layer: Layer): Promise<void> {
    // Handle source reference (string ID)
    if (typeof layer.source === 'string') {
      if (!this.map.getSource(layer.source)) {
        throw new Error(`Source reference '${layer.source}' not found`);
      }
      return;
    }

    // layer.source is now guaranteed to be an object
    const source = layer.source;

    if (source.type === 'geojson') {
      const geojsonSource = source as GeoJSONSourceConfig;
      if (geojsonSource.url) {
        await this.addGeoJSONSourceFromURL(sourceId, layer.id, geojsonSource);
      } else if (geojsonSource.data) {
        this.map.addSource(sourceId, {
          type: 'geojson',
          data: geojsonSource.data,
          cluster: geojsonSource.cluster,
          clusterRadius: geojsonSource.clusterRadius,
          clusterMaxZoom: geojsonSource.clusterMaxZoom,
          clusterMinPoints: geojsonSource.clusterMinPoints,
          clusterProperties: geojsonSource.clusterProperties,
        });
      } else if (geojsonSource.stream) {
        this.map.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
    } else if (source.type === 'vector') {
      const vectorSource = source as VectorSourceConfig;
      const vectorSpec: any = { type: 'vector' };
      if (vectorSource.url) vectorSpec.url = vectorSource.url;
      if (vectorSource.tiles) vectorSpec.tiles = vectorSource.tiles;
      if (vectorSource.minzoom !== undefined) vectorSpec.minzoom = vectorSource.minzoom;
      if (vectorSource.maxzoom !== undefined) vectorSpec.maxzoom = vectorSource.maxzoom;
      if (vectorSource.bounds) vectorSpec.bounds = vectorSource.bounds;
      if (vectorSource.attribution) vectorSpec.attribution = vectorSource.attribution;
      this.map.addSource(sourceId, vectorSpec);
    } else if (source.type === 'raster') {
      const rasterSource = source as RasterSourceConfig;
      const rasterSpec: any = { type: 'raster' };
      if (rasterSource.url) rasterSpec.url = rasterSource.url;
      if (rasterSource.tiles) rasterSpec.tiles = rasterSource.tiles;
      if (rasterSource.tileSize !== undefined) rasterSpec.tileSize = rasterSource.tileSize;
      if (rasterSource.minzoom !== undefined) rasterSpec.minzoom = rasterSource.minzoom;
      if (rasterSource.maxzoom !== undefined) rasterSpec.maxzoom = rasterSource.maxzoom;
      if (rasterSource.bounds) rasterSpec.bounds = rasterSource.bounds;
      if (rasterSource.attribution) rasterSpec.attribution = rasterSource.attribution;
      this.map.addSource(sourceId, rasterSpec);
    } else if (source.type === 'image') {
      const imageSource = source as ImageSourceConfig;
      this.map.addSource(sourceId, {
        type: 'image',
        url: imageSource.url,
        coordinates: imageSource.coordinates,
      });
    } else if (source.type === 'video') {
      const videoSource = source as VideoSourceConfig;
      this.map.addSource(sourceId, {
        type: 'video',
        urls: videoSource.urls,
        coordinates: videoSource.coordinates,
      });
    }
  }

  private async addGeoJSONSourceFromURL(sourceId: string, layerId: string, config: GeoJSONSourceConfig): Promise<void> {
    this.map.addSource(sourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: config.cluster,
      clusterRadius: config.clusterRadius,
      clusterMaxZoom: config.clusterMaxZoom,
      clusterMinPoints: config.clusterMinPoints,
      clusterProperties: config.clusterProperties,
    });

    await this.fetchAndUpdateSource(sourceId, layerId, config.url!, config);
  }

  private async fetchAndUpdateSource(sourceId: string, layerId: string, url: string, config: GeoJSONSourceConfig): Promise<void> {
    const retryAttempts = config.retryAttempts ?? 3;

    this.callbacks.onDataLoading?.(layerId);

    const controller = new AbortController();
    this.abortControllers.set(layerId, controller);

    for (let attempt = 0; attempt < retryAttempts; attempt++) {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

        const data = await response.json();
        if (!data || typeof data !== 'object') throw new Error('Invalid GeoJSON');

        const source = this.map.getSource(sourceId) as GeoJSONSource;
        if (source && source.setData) source.setData(data);

        const featureCount = data.features?.length ?? 0;
        this.callbacks.onDataLoaded?.(layerId, featureCount);
        return;
      } catch (error: any) {
        if (error.name === 'AbortError') return;
        if (attempt === retryAttempts - 1) {
          this.callbacks.onDataError?.(layerId, new Error(`Failed after ${retryAttempts} attempts: ${error.message}`));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  removeLayer(layerId: string): void {
    this.stopRefreshInterval(layerId);

    const controller = this.abortControllers.get(layerId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(layerId);
    }

    if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);

    const sourceId = `${layerId}-source`;
    if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
  }

  setVisibility(layerId: string, visible: boolean): void {
    if (!this.map.getLayer(layerId)) return;
    this.map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
  }

  updateData(layerId: string, data: GeoJSON.GeoJSON): void {
    const sourceId = `${layerId}-source`;
    const source = this.map.getSource(sourceId) as GeoJSONSource;
    if (source && source.setData) source.setData(data as any);
  }

  startRefreshInterval(layer: Layer): void {
    if (typeof layer.source !== 'object' || layer.source === null || layer.source.type !== 'geojson') {
      return;
    }

    const geojsonSource = layer.source as GeoJSONSourceConfig;
    if (!geojsonSource.url || !geojsonSource.refreshInterval) {
      return;
    }

    const interval = setInterval(() => {
      const sourceId = `${layer.id}-source`;
      this.fetchAndUpdateSource(sourceId, layer.id, geojsonSource.url!, geojsonSource);
    }, geojsonSource.refreshInterval);

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
    for (const interval of this.refreshIntervals.values()) clearInterval(interval);
    this.refreshIntervals.clear();
  }

  destroy(): void {
    this.clearAllIntervals();
    for (const controller of this.abortControllers.values()) controller.abort();
    this.abortControllers.clear();
  }
}
