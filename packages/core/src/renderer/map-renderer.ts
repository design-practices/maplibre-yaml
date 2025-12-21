/**
 * @file Main map renderer for MapLibre YAML
 * @module @maplibre-yaml/core/renderer
 */

import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import type { z } from 'zod';
import { MapConfigSchema, LayerSchema, ControlsConfigSchema, LegendConfigSchema } from '../schemas';
import { LayerManager, type LayerManagerCallbacks } from './layer-manager';
import { EventHandler, type EventHandlerCallbacks } from './event-handler';
import { LegendBuilder } from './legend-builder';
import { ControlsManager } from './controls-manager';

type MapConfig = z.infer<typeof MapConfigSchema>;
type Layer = z.infer<typeof LayerSchema>;
type ControlsConfig = z.infer<typeof ControlsConfigSchema>;
type LegendConfig = z.infer<typeof LegendConfigSchema>;

/**
 * Options for MapRenderer
 */
export interface MapRendererOptions {
  onLoad?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Events emitted by MapRenderer
 */
export interface MapRendererEvents {
  load: void;
  'layer:added': { layerId: string };
  'layer:removed': { layerId: string };
  'layer:data-loading': { layerId: string };
  'layer:data-loaded': { layerId: string; featureCount: number };
  'layer:data-error': { layerId: string; error: Error };
  'layer:click': { layerId: string; feature: any; lngLat: maplibregl.LngLat };
  'layer:hover': { layerId: string; feature: any; lngLat: maplibregl.LngLat };
}

/**
 * Main class for rendering maps from configuration
 */
export class MapRenderer {
  private map: MapLibreMap;
  private layerManager: LayerManager;
  private eventHandler: EventHandler;
  private legendBuilder: LegendBuilder;
  private controlsManager: ControlsManager;
  private eventListeners: Map<string, Set<Function>>;
  private isLoaded: boolean;

  constructor(container: string | HTMLElement, config: MapConfig, layers: Layer[] = [], options: MapRendererOptions = {}) {
    this.eventListeners = new Map();
    this.isLoaded = false;

    // Initialize MapLibre map
    this.map = new maplibregl.Map({
      ...config,
      container: typeof container === 'string' ? container : container,
      style: config.mapStyle as any,
      center: config.center as [number, number],
      zoom: config.zoom,
      pitch: config.pitch ?? 0,
      bearing: config.bearing ?? 0,
      interactive: config.interactive ?? true,
    } as any);

    // Initialize managers
    const layerCallbacks: LayerManagerCallbacks = {
      onDataLoading: (layerId) => this.emit('layer:data-loading', { layerId }),
      onDataLoaded: (layerId, featureCount) => this.emit('layer:data-loaded', { layerId, featureCount }),
      onDataError: (layerId, error) => this.emit('layer:data-error', { layerId, error }),
    };

    const eventCallbacks: EventHandlerCallbacks = {
      onClick: (layerId, feature, lngLat) => this.emit('layer:click', { layerId, feature, lngLat }),
      onHover: (layerId, feature, lngLat) => this.emit('layer:hover', { layerId, feature, lngLat }),
    };

    this.layerManager = new LayerManager(this.map, layerCallbacks);
    this.eventHandler = new EventHandler(this.map, eventCallbacks);
    this.legendBuilder = new LegendBuilder();
    this.controlsManager = new ControlsManager(this.map);

    // Set up load handler
    this.map.on('load', () => {
      this.isLoaded = true;

      // Add layers
      Promise.all(layers.map((layer) => this.addLayer(layer)))
        .then(() => {
          this.emit('load', undefined);
          options.onLoad?.();
        })
        .catch((error) => {
          options.onError?.(error);
        });
    });

    // Handle errors
    this.map.on('error', (e) => {
      options.onError?.(e.error);
    });
  }

  /**
   * Get the underlying MapLibre map instance
   */
  getMap(): MapLibreMap {
    return this.map;
  }

  /**
   * Check if map is loaded
   */
  isMapLoaded(): boolean {
    return this.isLoaded;
  }

  /**
   * Add a layer to the map
   */
  async addLayer(layer: Layer): Promise<void> {
    await this.layerManager.addLayer(layer);
    this.eventHandler.attachEvents(layer);
    this.emit('layer:added', { layerId: layer.id });
  }

  /**
   * Remove a layer from the map
   */
  removeLayer(layerId: string): void {
    this.eventHandler.detachEvents(layerId);
    this.layerManager.removeLayer(layerId);
    this.emit('layer:removed', { layerId });
  }

  /**
   * Set layer visibility
   */
  setLayerVisibility(layerId: string, visible: boolean): void {
    this.layerManager.setVisibility(layerId, visible);
  }

  /**
   * Update layer data
   */
  updateLayerData(layerId: string, data: GeoJSON.GeoJSON): void {
    this.layerManager.updateData(layerId, data);
  }

  /**
   * Add controls to the map
   */
  addControls(config: ControlsConfig): void {
    this.controlsManager.addControls(config);
  }

  /**
   * Build legend in container
   */
  buildLegend(container: string | HTMLElement, layers: Layer[], config?: LegendConfig): void {
    this.legendBuilder.build(container, layers, config);
  }

  /**
   * Register an event listener
   */
  on<K extends keyof MapRendererEvents>(event: K, callback: (data: MapRendererEvents[K]) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  /**
   * Unregister an event listener
   */
  off<K extends keyof MapRendererEvents>(event: K, callback: Function): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  /**
   * Emit an event
   */
  private emit<K extends keyof MapRendererEvents>(event: K, data: MapRendererEvents[K]): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const callback of listeners) {
        callback(data);
      }
    }
  }

  /**
   * Destroy the map and clean up resources
   */
  destroy(): void {
    this.eventHandler.destroy();
    this.layerManager.destroy();
    this.controlsManager.removeAllControls();
    this.eventListeners.clear();
    this.map.remove();
  }
}
