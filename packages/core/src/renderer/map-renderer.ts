/**
 * @file Main map renderer for MapLibre YAML
 * @module @maplibre-yaml/core/renderer
 */

import type { LngLat } from 'maplibre-gl';
import { Map as MapLibreMap } from './maplibre-interop';
import type { z } from 'zod';
import { MapConfigSchema, LayerSchema, LayerSourceSchema, ControlsConfigSchema, LegendConfigSchema } from '../schemas';
import { LayerManager, type LayerManagerCallbacks } from './layer-manager';
import { EventHandler, type EventHandlerCallbacks } from './event-handler';
import { LegendBuilder } from './legend-builder';
import { ControlsManager } from './controls-manager';

type MapConfig = z.infer<typeof MapConfigSchema>;
type Layer = z.infer<typeof LayerSchema>;
type LayerSource = z.infer<typeof LayerSourceSchema>;
type ControlsConfig = z.infer<typeof ControlsConfigSchema>;
type LegendConfig = z.infer<typeof LegendConfigSchema>;

/**
 * Options for MapRenderer
 */
export interface MapRendererOptions {
  onLoad?: () => void;
  onError?: (error: Error) => void;
  /** Controls declared in the YAML `controls:` block — added automatically on map load */
  controls?: ControlsConfig;
  /** Legend declared in the YAML `legend:` block — built automatically on map load */
  legend?: LegendConfig;
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
  'layer:click': { layerId: string; feature: any; lngLat: LngLat };
  'layer:hover': { layerId: string; feature: any; lngLat: LngLat };
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
  private containerEl: HTMLElement | null;
  private controlsAdded: boolean;
  private legendBuilt: boolean;
  private autoLegendContainer: HTMLElement | null;

  constructor(container: string | HTMLElement, config: MapConfig, layers: Layer[] = [], options: MapRendererOptions = {}, sources?: Record<string, LayerSource>) {
    this.eventListeners = new Map();
    this.isLoaded = false;
    this.containerEl = typeof container === 'string' ? document.getElementById(container) : container;
    this.controlsAdded = false;
    this.legendBuilt = false;
    this.autoLegendContainer = null;

    // Initialize MapLibre map
    this.map = new MapLibreMap({
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

      // Add named sources from block config before processing layers
      if (sources) {
        for (const [id, sourceSpec] of Object.entries(sources)) {
          if (!this.map.getSource(id)) {
            this.map.addSource(id, sourceSpec as any);
          }
        }
      }

      // Apply YAML-declared controls and legend once the map is ready.
      // The guards keep manual addControls()/buildLegend() calls made before
      // load from being duplicated here.
      // NOTE: packages/astro/src/components/FullPageMap.astro has its own
      // hand-rolled controls/legend implementation; consolidating the two is
      // tracked in the perf/hygiene backlog.
      if (options.controls && !this.controlsAdded) {
        this.addControls(options.controls);
      }
      if (options.legend && !this.legendBuilt) {
        this.buildLegend(this.createLegendContainer(options.legend), layers, options.legend);
      }

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
   *
   * @remarks
   * Called automatically on map load when a `controls:` config was passed via
   * {@link MapRendererOptions}. Calling it manually marks controls as added so
   * the automatic invocation is skipped (no double-add).
   */
  addControls(config: ControlsConfig): void {
    this.controlsAdded = true;
    this.controlsManager.addControls(config);
  }

  /**
   * Build legend in container
   *
   * @remarks
   * Called automatically on map load when a `legend:` config was passed via
   * {@link MapRendererOptions}. Calling it manually marks the legend as built
   * so the automatic invocation is skipped (no double-build).
   */
  buildLegend(container: string | HTMLElement, layers: Layer[], config?: LegendConfig): void {
    this.legendBuilt = true;
    this.legendBuilder.build(container, layers, config);
  }

  /**
   * Create a positioned container inside the map element for the auto legend
   */
  private createLegendContainer(config: LegendConfig): HTMLElement {
    const el = document.createElement('div');
    el.className = 'ml-map-legend';
    const position = config.position ?? 'top-left';
    el.style.position = 'absolute';
    el.style.zIndex = '1';
    el.style[position.includes('top') ? 'top' : 'bottom'] = '10px';
    el.style[position.includes('left') ? 'left' : 'right'] = '10px';
    (this.containerEl ?? this.map.getContainer()).appendChild(el);
    this.autoLegendContainer = el;
    return el;
  }

  /**
   * Get the legend builder instance
   */
  getLegendBuilder(): LegendBuilder {
    return this.legendBuilder;
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
    this.autoLegendContainer?.remove();
    this.autoLegendContainer = null;
    this.eventListeners.clear();
    this.map.remove();
  }
}
