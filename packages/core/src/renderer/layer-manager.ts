/**
 * @file Layer manager for MapLibre map layers
 * @module @maplibre-yaml/core/renderer
 */

import type { Map as MapLibreMap, GeoJSONSource, AnySourceData } from 'maplibre-gl';
import type { z } from 'zod';
import { LayerSchema, GeoJSONSourceSchema } from '../schemas';

type Layer = z.infer<typeof LayerSchema>;
type GeoJSONSourceConfig = z.infer<typeof GeoJSONSourceSchema>;

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

    this.map.addLayer(layerSpec, layer.before);

    if (typeof layer.source === 'object' && layer.source.type === 'geojson' && layer.source.refreshInterval) {
      this.startRefreshInterval(layer);
    }
  }

  private async addSource(sourceId: string, layer: Layer): Promise<void> {
    if (typeof layer.source === 'string') {
      if (!this.map.getSource(layer.source)) {
        throw new Error(`Source reference '${layer.source}' not found`);
      }
      return;
    }

    const source = layer.source;

    switch (source.type) {
      case 'geojson':
        if (source.url) {
          await this.addGeoJSONSourceFromURL(sourceId, layer.id, source);
        } else if (source.data) {
          this.map.addSource(sourceId, {
            type: 'geojson',
            data: source.data,
            cluster: source.cluster,
            clusterRadius: source.clusterRadius,
            clusterMaxZoom: source.clusterMaxZoom,
            clusterMinPoints: source.clusterMinPoints,
            clusterProperties: source.clusterProperties,
          } as AnySourceData);
        } else if (source.stream) {
          this.map.addSource(sourceId, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          } as AnySourceData);
        }
        break;

      case 'vector': {
        const vectorSource: any = { type: 'vector' };
        if (source.url) vectorSource.url = source.url;
        if (source.tiles) vectorSource.tiles = source.tiles;
        if (source.minzoom !== undefined) vectorSource.minzoom = source.minzoom;
        if (source.maxzoom !== undefined) vectorSource.maxzoom = source.maxzoom;
        if (source.bounds) vectorSource.bounds = source.bounds;
        if (source.attribution) vectorSource.attribution = source.attribution;
        this.map.addSource(sourceId, vectorSource);
        break;
      }

      case 'raster': {
        const rasterSource: any = { type: 'raster' };
        if (source.url) rasterSource.url = source.url;
        if (source.tiles) rasterSource.tiles = source.tiles;
        if (source.tileSize !== undefined) rasterSource.tileSize = source.tileSize;
        if (source.minzoom !== undefined) rasterSource.minzoom = source.minzoom;
        if (source.maxzoom !== undefined) rasterSource.maxzoom = source.maxzoom;
        if (source.bounds) rasterSource.bounds = source.bounds;
        if (source.attribution) rasterSource.attribution = source.attribution;
        this.map.addSource(sourceId, rasterSource);
        break;
      }

      case 'image':
        this.map.addSource(sourceId, {
          type: 'image',
          url: source.url,
          coordinates: source.coordinates,
        } as AnySourceData);
        break;

      case 'video':
        this.map.addSource(sourceId, {
          type: 'video',
          urls: source.urls,
          coordinates: source.coordinates,
        } as AnySourceData);
        break;
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
    } as AnySourceData);

    await this.fetchAndUpdateSource(sourceId, layerId, config.url!, config);
  }

  private async fetchAndUpdateSource(sourceId: string, layerId: string, url: string, config: GeoJSONSourceConfig): Promise<void> {
    const timeout = config.timeout ?? 30000;
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
    if (typeof layer.source !== 'object' || layer.source.type !== 'geojson' || !layer.source.url) return;

    const interval = setInterval(() => {
      const sourceId = `${layer.id}-source`;
      this.fetchAndUpdateSource(sourceId, layer.id, layer.source.url!, layer.source as GeoJSONSourceConfig);
    }, layer.source.refreshInterval!);

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
