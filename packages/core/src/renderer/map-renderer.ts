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
import type { MarkerConfig } from '../schemas/map.schema';
import { ControlsManager } from './controls-manager';
import { MarkersManager } from './markers-manager';
import { loadDocumentImages } from './images-loader';
import type { ImageConfig } from '../schemas/map.schema';
import type { CapabilityPolicy } from "../capabilities.js";
import {
  denormalizeConfig,
  denormalizeLayers,
  denormalizeSources,
  denormalizeOptions,
  type MapModel,
} from "../model/index.js";

type MapConfig = z.infer<typeof MapConfigSchema>;
type Layer = z.infer<typeof LayerSchema>;
type LayerSource = z.infer<typeof LayerSourceSchema>;
type ControlsConfig = z.infer<typeof ControlsConfigSchema>;
type LegendConfig = z.infer<typeof LegendConfigSchema>;

/**
 * Whether the YAML `controls.attribution` control is configured.
 *
 * Uses the same bare-truthiness convention as every control branch in
 * `ControlsManager.addControls` — a `true` or any options object enables the
 * control; `false`/absent disables it. This MUST stay in lockstep with the ADD
 * decision in `ControlsManager`: if this predicate and that branch disagree
 * (e.g. one honors `enabled: false` and the other doesn't), a configured
 * attribution control and MapLibre's built-in default can both render.
 */
function isAttributionControlEnabled(controls?: ControlsConfig): boolean {
  const attribution = controls?.attribution;
  return attribution != null && attribution !== false;
}

/**
 * Options for MapRenderer
 */
export interface MapRendererOptions {
  onLoad?: () => void;
  /**
   * `fatal` distinguishes load-aborting failures (source registration, layer
   * add — the document will never reach `load`) from runtime maplibre error
   * events (a 404'd tile, a missing sprite) that the map survives. Optional
   * second argument, so existing single-arg callbacks are unaffected.
   */
  onError?: (error: Error, fatal?: boolean) => void;
  /** Controls declared in the YAML `controls:` block — added automatically on map load */
  controls?: ControlsConfig;
  /** Legend declared in the YAML `legend:` block — built automatically on map load */
  legend?: LegendConfig;
  /**
   * Trust and runtime capabilities for this map.
   *
   * @remarks
   * Gates render-time behavior an author could otherwise abuse — most directly
   * whether an `!html` popup value renders as markup or as escaped text.
   * Omitted means untrusted: a host embedding a document it did not author gets
   * the safe default without opting into it.
   */
  capabilities?: CapabilityPolicy;
  /**
   * The document's `state:` block (`{ key: { default } }` per the style
   * spec). Applied on load via `setGlobalStateProperty` so `global-state`
   * expressions read the declared defaults — the live style is built from
   * `mapStyle` + addLayer, so the block cannot ride in on the style object.
   */
  state?: Record<string, unknown>;
  /** Standalone `markers:` — DOM pins added on load, removed on destroy. */
  markers?: MarkerConfig[];
  /**
   * Named images (`images:`) registered via `map.addImage` before layers are
   * added, so `icon-image`/`*-pattern` references resolve on first render.
   */
  images?: Record<string, ImageConfig>;
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
  'markers:added': { count: number };
  'marker:click': { index: number; at: [number, number] };
  'marker:icon-error': { index: number; icon: string };
  'image:error': { name: string; url: string };
}

/**
 * Main class for rendering maps from configuration
 */
export class MapRenderer {
  private map: MapLibreMap;
  private layerManager: LayerManager;
  private eventHandler: EventHandler;
  private legendBuilder: LegendBuilder;
  private markersManager: MarkersManager | null = null;
  private controlsManager: ControlsManager;
  private eventListeners: Map<string, Set<Function>>;
  private isLoaded: boolean;
  private containerEl: HTMLElement | null;
  private controlsAdded: boolean;
  private legendBuilt: boolean;
  private autoLegendContainer: HTMLElement | null;


  /**
   * Construct a renderer from the v2 internal model.
   *
   * @remarks
   * The model is the shape the emitter is written against (R30), and this is
   * how the renderer consumes the same one. v0.5.0 keeps the v1 constructor as
   * the compatibility surface — it is public API with external callers, and
   * breaking it inside a minor is not on the table — so this factory
   * reassembles the v1 arguments rather than the managers being rewritten onto
   * new shapes.
   *
   * `<ml-map>` does not call this — it derives the same arguments inline, so
   * the component test double (which mocks `MapRenderer` as a bare function
   * with no statics) keeps working. This factory is for callers that already
   * hold a model. It differs from the inline path in one respect worth knowing:
   * caller `options` win over the model's `controls`/`legend`, so passing
   * `{ controls: undefined }` erases them.
   */
  static fromModel(
    container: string | HTMLElement,
    model: MapModel,
    options: MapRendererOptions = {}
  ): MapRenderer {
    return new MapRenderer(
      container,
      denormalizeConfig(model),
      denormalizeLayers(model),
      { ...denormalizeOptions(model), ...options },
      denormalizeSources(model)
    );
  }

  constructor(container: string | HTMLElement, config: MapConfig, layers: Layer[] = [], options: MapRendererOptions = {}, sources?: Record<string, LayerSource>) {
    this.eventListeners = new Map();
    this.isLoaded = false;
    this.containerEl = typeof container === 'string' ? document.getElementById(container) : container;
    this.controlsAdded = false;
    this.legendBuilt = false;
    this.autoLegendContainer = null;

    // When a `controls.attribution` control is configured, MapLibre's built-in
    // attribution must be disabled at construction time so the two don't
    // double-render. An explicit `config.attributionControl: true` conflicts;
    // the configured control wins, with a warning.
    const attributionControlConfigured = isAttributionControlEnabled(options.controls);
    if (attributionControlConfigured && config.attributionControl === true) {
      console.warn(
        '[maplibre-yaml] `controls.attribution` overrides `attributionControl: true`; ' +
          "MapLibre's built-in attribution is disabled to avoid a duplicate control.",
      );
    }

    // maplibre-gl v5 moved the WebGL context options into
    // `canvasContextAttributes`; v4 and earlier read them at the top level.
    // The YAML surface keeps the flat keys, and we hand MapLibre both shapes —
    // each major reads the one it knows and ignores the other — so
    // `preserveDrawingBuffer: true` keeps working across the peer range
    // instead of silently dying on v5 (U1 breakpoint audit).
    // Seed from an author-supplied canvasContextAttributes (config keys ride
    // the passthrough), so the flat keys layer over it instead of clobbering.
    const authorAttributes = (config as Record<string, unknown>)['canvasContextAttributes'];
    const contextAttributes: Record<string, unknown> =
      authorAttributes && typeof authorAttributes === 'object'
        ? { ...(authorAttributes as Record<string, unknown>) }
        : {};
    for (const key of ['antialias', 'preserveDrawingBuffer', 'failIfMajorPerformanceCaveat'] as const) {
      const value = config[key];
      if (value !== undefined) contextAttributes[key] = value;
    }

    // Initialize MapLibre map
    this.map = new MapLibreMap({
      ...config,
      ...(Object.keys(contextAttributes).length > 0
        ? { canvasContextAttributes: contextAttributes }
        : {}),
      container: typeof container === 'string' ? container : container,
      style: config.mapStyle as any,
      center: config.center as [number, number],
      zoom: config.zoom,
      pitch: config.pitch ?? 0,
      bearing: config.bearing ?? 0,
      interactive: config.interactive ?? true,
      // Set ONLY when we need to suppress the built-in control. Passing the key
      // with an undefined value is not the same as omitting it: MapLibre merges
      // options over its defaults, so `attributionControl: undefined` overwrites
      // the default and the map ends up with no attribution at all — a
      // licensing problem, not just a cosmetic one. When unconfigured, the key
      // comes from `...config` alone (i.e. only if the author set it).
      ...(attributionControlConfigured ? { attributionControl: false } : {}),
    } as any);

    // Initialize managers
    const layerCallbacks: LayerManagerCallbacks = {
      onDataLoading: (layerId) => this.emit('layer:data-loading', { layerId }),
      onDataLoaded: (layerId, featureCount) => {
        // Refreshed data means new features. Feature-state is keyed by id and
        // survives setData, so a retained highlight id would light up whichever
        // feature now holds it — a different one. Drop it; the next mousemove
        // re-applies the highlight under the cursor.
        this.eventHandler.resetFeatureState(layerId);
        this.emit('layer:data-loaded', { layerId, featureCount });
      },
      onDataError: (layerId, error) => this.emit('layer:data-error', { layerId, error }),
    };

    const eventCallbacks: EventHandlerCallbacks = {
      onClick: (layerId, feature, lngLat) => this.emit('layer:click', { layerId, feature, lngLat }),
      onHover: (layerId, feature, lngLat) => this.emit('layer:hover', { layerId, feature, lngLat }),
    };

    this.layerManager = new LayerManager(this.map, layerCallbacks);
    this.eventHandler = new EventHandler(this.map, eventCallbacks, options.capabilities);
    this.legendBuilder = new LegendBuilder();
    this.controlsManager = new ControlsManager(this.map);

    // Set up load handler
    this.map.on('load', () => {
      this.isLoaded = true;

      // Named sources are registered through LayerManager rather than added
      // raw here: it scrubs YAML-only keys and owns the refresh machinery, so
      // a named source declaring `refresh:` actually polls.
      // Guarded: a synchronous throw inside MapLibre's `load` handler is
      // otherwise swallowed by the event loop, and the document dies with an
      // empty basemap and no error anywhere — the ml-blj failure shape
      // (ml-tfd.8 contract audit).
      try {
        if (sources) {
          this.layerManager.registerSources(sources as Record<string, unknown>);
        }
      } catch (error) {
        options.onError?.(error as Error, true);
        return;
      }

      // Apply the document's `state:` defaults before layers are added, so a
      // layer whose filter/paint reads `global-state` never evaluates against
      // null. `setGlobalStateProperty` exists from maplibre-gl 5.6; on older
      // runtimes a declared `state:` block warns once instead of silently
      // doing nothing (the declared-absence posture, R5/U8).
      if (options.state && Object.keys(options.state).length > 0) {
        const setState = (this.map as unknown as {
          setGlobalStateProperty?: (name: string, value: unknown) => void;
        }).setGlobalStateProperty;
        if (typeof setState === 'function') {
          for (const [key, entry] of Object.entries(options.state)) {
            // Spec shape is { default: value }. An object without `default`
            // declares nothing — skip it rather than hand the object itself
            // to the runtime as the state value. Bare (non-object) entries
            // are accepted as raw values for programmatic callers.
            if (entry && typeof entry === 'object') {
              if (!('default' in entry)) continue;
              const value = (entry as { default?: unknown }).default;
              if (value !== undefined) setState.call(this.map, key, value);
            } else if (entry !== undefined) {
              setState.call(this.map, key, entry);
            }
          }
        } else {
          console.warn(
            '[maplibre-yaml] this document declares `state:`, but the running ' +
              'maplibre-gl has no setGlobalStateProperty (needs >= 5.6); ' +
              '`global-state` expressions will read null.',
          );
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

      // Standalone markers: DOM pins with the document's popup content run
      // through the same trust gate as every popup sink (U5).
      if (options.markers && options.markers.length > 0) {
        this.markersManager = new MarkersManager(this.map, options.capabilities, {
          onMarkersAdded: (count) => this.emit('markers:added', { count }),
          onMarkerClick: (index, at) => this.emit('marker:click', { index, at }),
          onMarkerIconError: (index, icon) =>
            this.emit('marker:icon-error', { index, icon }),
        });
        this.markersManager.add(options.markers as MarkerConfig[]);
      }

      // Declared images register BEFORE layers so icon-image/*-pattern
      // references resolve on first render (never rejects — a failed image
      // warns and the layer draws without it, per ml-blj).
      const imagesReady =
        options.images && Object.keys(options.images).length > 0
          ? loadDocumentImages(this.map, options.images, (name, url) =>
              this.emit('image:error', { name, url })
            )
          : Promise.resolve();

      // Add layers
      imagesReady
        .then(() => Promise.all(layers.map((layer) => this.addLayer(layer))))
        .then(() => {
          this.emit('load', undefined);
          options.onLoad?.();
        })
        .catch((error) => {
          options.onError?.(error, true);
        });
    });

    // An image name no declared image or sprite supplies: warn once per
    // name instead of letting MapLibre spam one warning per render.
    const missingWarned = new Set<string>();
    this.map.on('styleimagemissing', (e: { id: string }) => {
      if (missingWarned.has(e.id)) return;
      missingWarned.add(e.id);
      console.warn(
        `[maplibre-yaml] layer references image "${e.id}" but no images: entry, ` +
          'sprite, or addImage call supplies it.'
      );
    });

    // Handle errors. Runtime maplibre error events are non-fatal: the map
    // still reaches `load` after a failed tile/sprite/glyph request.
    this.map.on('error', (e) => {
      options.onError?.(e.error, false);
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
    // Same reasoning as the refresh path: replacing the data invalidates any
    // tracked feature id, so clear before the new features land.
    this.eventHandler.resetFeatureState(layerId);
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
    this.markersManager?.destroy();
    this.markersManager = null;
    this.controlsManager.removeAllControls();
    this.autoLegendContainer?.remove();
    this.autoLegendContainer = null;
    this.eventListeners.clear();
    this.map.remove();
  }
}
