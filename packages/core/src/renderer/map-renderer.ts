/**
 * @file Main map renderer for MapLibre YAML
 * @module @maplibre-yaml/core/renderer
 */

import type { LngLat } from 'maplibre-gl';
import { Map as MapLibreMap, AttributionControl, runtimeVersion, withWorkerUrlHint } from './maplibre-interop';
import { installAttributionGuard, type AttributionGuard } from './attribution-guard';
import { sanitizeCustomAttribution, sanitizeSourcesAttribution } from '../utils/attribution';
import type { z } from 'zod';
import { MapConfigSchema, LayerSchema, LayerSourceSchema, ControlsConfigSchema, LegendConfigSchema } from '../schemas';
import { LayerManager, type LayerManagerCallbacks } from './layer-manager';
import { EventHandler, type EventHandlerCallbacks } from './event-handler';
import { LegendBuilder } from './legend-builder';
import type { MarkerConfig, StandalonePopupConfig, FitToConfig } from '../schemas/map.schema';
import { ControlsManager } from './controls-manager';
import { MarkersManager } from './markers-manager';
import { PopupsManager } from './popups-manager';
import { geojsonBounds, type Bounds } from '../interactions/geometry-bounds';
import { COLOR_RELIEF_RUNTIME_FLOOR, meetsVersion } from '../capabilities';
import { loadDocumentImages } from './images-loader';
import { ChromeLayout, type ChromeCorner } from './chrome-layout';
import {
  ParamsBuilder,
  hasPanelContent,
  type ParamsPanelConfig,
  type ParameterMeta,
} from './params-builder';
import type {
  ImageConfig,
  LightConfig,
  TerrainConfig,
  SkyConfig,
  ProjectionConfig,
} from '../schemas/map.schema';
import { applyProjection, applySky, applyTerrain, type Scene3DMap } from './scene-3d';
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
 * How a `fitTo` (U14) resolves against the document's named sources.
 *
 * - `bounds` — inline data: known before the map exists.
 * - `deferred` — a fetched geojson source: fit on its first data load.
 * - `unsupported` — missing name, non-geojson source, or empty data: the
 *   authored center/zoom stand, with one warning naming why.
 */
type FitResolution =
  | { kind: 'bounds'; bounds: Bounds }
  | { kind: 'deferred' }
  | { kind: 'unsupported'; reason: string };

function resolveFitTo(
  fitTo: FitToConfig,
  sources: Record<string, unknown> | undefined
): FitResolution {
  const keep = 'keeping the authored center/zoom.';
  const source = sources?.[fitTo.source] as Record<string, unknown> | undefined;
  if (!source || typeof source !== 'object') {
    return {
      kind: 'unsupported',
      reason:
        `fitTo.source "${fitTo.source}" names no entry in \`sources:\` ` +
        `(inline layer sources cannot be named — move it to \`sources:\`); ${keep}`,
    };
  }
  if (source['type'] !== 'geojson') {
    return {
      kind: 'unsupported',
      reason:
        `fitTo.source "${fitTo.source}" is a ${String(source['type'])} source; only ` +
        `GeoJSON sources have a client-side extent to fit (tiled sources do not); ${keep}`,
    };
  }
  const inline = source['data'] ?? source['prefetchedData'];
  if (inline !== undefined && !source['url']) {
    const bounds = geojsonBounds(inline);
    if (bounds) return { kind: 'bounds', bounds };
    return {
      kind: 'unsupported',
      reason: `fitTo.source "${fitTo.source}" has no coordinates to fit; ${keep}`,
    };
  }
  if (source['prefetchedData'] !== undefined) {
    const bounds = geojsonBounds(source['prefetchedData']);
    if (bounds) return { kind: 'bounds', bounds };
  }
  return { kind: 'deferred' };
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
  /** Standalone `popups:` (U14) — opened at their coordinates on load. */
  popups?: StandalonePopupConfig[];
  /**
   * Named images (`images:`) registered via `map.addImage` before layers are
   * added, so `icon-image`/`*-pattern` references resolve on first render.
   */
  images?: Record<string, ImageConfig>;
  /**
   * The style-spec `light` (U10′), applied with `map.setLight` on load —
   * the live style is built from `mapStyle` + addLayer, so the document's
   * light cannot ride in on the style object.
   */
  light?: LightConfig;
  /**
   * `parameters:` presentation metadata — rendered as the params panel
   * (U8), each control writing its state key via `setGlobalStateProperty`.
   * Loosely typed to match the schema's passthrough record; the panel
   * builder reads it as {@link ParameterMeta}.
   */
  parameters?: Record<string, unknown>;
  /**
   * Map-level 3D terrain (`terrain:`, U15). Applied via `map.setTerrain`
   * once its `raster-dem` source exists — the live style is built from
   * `mapStyle` + addLayer, so it cannot ride in on the style object.
   */
  terrain?: TerrainConfig;
  /** Sky / fog / atmosphere (`sky:`, U15) — `map.setSky`, maplibre-gl >= 4.5. */
  sky?: SkyConfig;
  /** Projection (`projection:`, U15) — `map.setProjection`, maplibre-gl >= 5. */
  projection?: ProjectionConfig;
  /**
   * Host-supplied chrome elements (U9 — `<ml-map>` slot children), mounted
   * into the shared corner system (KTD10) on load, after the built-in
   * legend and params panel so those keep the corner edge. The renderer
   * BORROWS these elements: destroy() removes the corner containers they sit
   * in, so a host that wants them back (re-render, error card) must move
   * them out first — `<ml-map>` parks them on itself.
   */
  chrome?: ChromeMount[];
  /**
   * Host-supplied legend element that REPLACES the built-in legend (the
   * `legend` slot). Mounted at `legend.position` (default `top-left`); the
   * auto legend is not built. Borrowed, like {@link chrome}.
   */
  legendElement?: HTMLElement;
}

/** One host-supplied chrome element and the corner it mounts into. */
export interface ChromeMount {
  position: ChromeCorner;
  element: HTMLElement;
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
  'parameter:change': { key: string; value: unknown };
  'layer:visibility': { layerId: string; visible: boolean };
  /** The `fitTo` camera (U14) framed its source's data. */
  'camera:fit': { source: string; bounds: Bounds };
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
  private popupsManager: PopupsManager | null = null;
  /** Layer types this runtime cannot render, warned once each (U14). */
  private warnedUnsupportedTypes = new Set<string>();
  private controlsManager: ControlsManager;
  private attributionGuard: AttributionGuard;
  private eventListeners: Map<string, Set<Function>>;
  private isLoaded: boolean;
  private containerEl: HTMLElement | null;
  private controlsAdded: boolean;
  private legendBuilt: boolean;
  private paramsBuilt = false;
  /** Lazily created on the first chrome mount (KTD10 corner system). */
  private chrome: ChromeLayout | null = null;
  /** Panel toggles made before the layer chain settles — applied after. */
  private pendingVisibility = new Map<string, boolean>();
  private layersAdded = false;
  /** Set by destroy(); late async continuations (image loads) check it. */
  private destroyed = false;
  /** `fitTo` (U14): the inline-data fit the constructor applied, if any. */
  private mapReadyFit: { source: string; bounds: Bounds } | null = null;
  /** `fitTo` (U14): set once the camera framed its source — never re-fit. */
  private fitApplied = false;
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

    // An inline style object's source attributions are document-authored;
    // sanitize them before MapLibre ever holds them (GHSA-jrc7-96c5-q579, see
    // utils/attribution.ts). A style URL is covered by the attribution guard.
    let mapStyle: unknown = config.mapStyle;
    if (mapStyle && typeof mapStyle === 'object' && 'sources' in mapStyle) {
      const styleObject = mapStyle as Record<string, unknown>;
      const sources = sanitizeSourcesAttribution(styleObject['sources']);
      if (sources !== styleObject['sources']) mapStyle = { ...styleObject, sources };
    }
    // `fitTo` (U14) is ours, not a MapLibre option: strip it from what the
    // constructor sees. Inline data resolves to bounds NOW, so the map is
    // constructed already framed (MapLibre's own `bounds` option — no
    // camera jump); fetched data fits once its first load lands (below).
    const { fitTo, ...mapConfig } = config as MapConfig & { fitTo?: FitToConfig };
    const fit = fitTo ? resolveFitTo(fitTo, sources) : null;
    const initialFit =
      fit && fit.kind === 'bounds'
        ? {
            bounds: fit.bounds,
            fitBoundsOptions: {
              ...(fitTo!.padding !== undefined ? { padding: fitTo!.padding } : {}),
              ...(fitTo!.maxZoom !== undefined ? { maxZoom: fitTo!.maxZoom } : {}),
            },
          }
        : {};
    if (fit && fit.kind === 'unsupported') console.warn(`[maplibre-yaml] ${fit.reason}`);

    // Initialize MapLibre map
    this.map = new MapLibreMap({
      ...mapConfig,
      ...initialFit,
      ...(Object.keys(contextAttributes).length > 0
        ? { canvasContextAttributes: contextAttributes }
        : {}),
      container: typeof container === 'string' ? container : container,
      style: mapStyle as any,
      center: config.center as [number, number],
      zoom: config.zoom,
      pitch: config.pitch ?? 0,
      bearing: config.bearing ?? 0,
      interactive: config.interactive ?? true,
      // The built-in control is ALWAYS disabled at construction; the renderer
      // adds the equivalent control itself just below. MapLibre adds its
      // built-in inside the constructor, which registers the control's data
      // listeners before any of ours could be — and the attribution guard has
      // to run first (see attribution-guard.ts).
      attributionControl: false,
    } as any);
    if (fitTo && fit && fit.kind === 'bounds') {
      this.mapReadyFit = { source: fitTo.source, bounds: fit.bounds };
    }

    this.attributionGuard = installAttributionGuard(this.map);

    // Stand-in for the built-in attribution control, added after the guard so
    // its listeners fire second. Unless `controls.attribution` supplies one
    // (added on load) or the author turned attribution off. An options object
    // under `attributionControl` (v2 `runtime.map` passes it through) is
    // honored as MapLibre would, with its customAttribution sanitized; so is a
    // top-level `customAttribution`, maplibre-gl 3's spelling of the option.
    const builtInAttribution = (config as Record<string, unknown>)['attributionControl'];
    if (!attributionControlConfigured && builtInAttribution !== false) {
      let controlOptions: Record<string, unknown> | undefined =
        builtInAttribution && typeof builtInAttribution === 'object'
          ? { ...(builtInAttribution as Record<string, unknown>) }
          : undefined;
      const topLevelCustom = (config as Record<string, unknown>)['customAttribution'];
      if (controlOptions && 'customAttribution' in controlOptions) {
        controlOptions['customAttribution'] = sanitizeCustomAttribution(
          controlOptions['customAttribution']
        ).value;
      } else if (topLevelCustom !== undefined) {
        controlOptions = {
          ...(controlOptions ?? {}),
          customAttribution: sanitizeCustomAttribution(topLevelCustom).value,
        };
      }
      // No options means MapLibre's own defaults, exactly as the built-in
      // would have used them (they differ across majors).
      this.map.addControl(
        controlOptions
          ? new AttributionControl(controlOptions as any)
          : new AttributionControl()
      );
    }

    // Initialize managers
    const layerCallbacks: LayerManagerCallbacks = {
      onDataLoading: (layerId) => this.emit('layer:data-loading', { layerId }),
      onDataLoaded: (layerId, featureCount) => {
        // A fetched `fitTo` source frames the camera on its FIRST load only:
        // after that the user owns the camera, and a refresh must not yank it.
        if (fitTo && fit && fit.kind === 'deferred' && !this.fitApplied) {
          const data = this.layerManager.getSourceData(fitTo.source);
          const bounds = data ? geojsonBounds(data) : null;
          if (bounds) {
            this.fitApplied = true;
            this.map.fitBounds(bounds, {
              ...(fitTo.padding !== undefined ? { padding: fitTo.padding } : {}),
              ...(fitTo.maxZoom !== undefined ? { maxZoom: fitTo.maxZoom } : {}),
              animate: false,
            });
            this.emit('camera:fit', { source: fitTo.source, bounds });
          }
        }
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
    this.controlsManager = new ControlsManager(this.map, {
      ...(options.terrain ? { terrain: options.terrain } : {}),
      beforeAttribution: () => this.attributionGuard.scrub(),
    });

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
      const setState = (this.map as unknown as {
        setGlobalStateProperty?: (name: string, value: unknown) => void;
      }).setGlobalStateProperty;
      if (options.state && Object.keys(options.state).length > 0) {
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

      // Map-level 3D (U15). Projection and sky first — neither depends on a
      // source. Terrain needs its raster-dem source to exist: named sources
      // just registered above, and basemap sources arrived with the style,
      // so most documents resolve here; a miss retries once layers settle
      // (an inline layer source), and only that retry warns. Each setter is
      // feature-detected and degrades with one warning, never a throw.
      const map3d = this.map as unknown as Scene3DMap;
      if (options.projection) applyProjection(map3d, options.projection);
      if (options.sky) applySky(map3d, options.sky);
      const terrainPending =
        options.terrain !== undefined &&
        applyTerrain(map3d, options.terrain, false) === 'pending';
      // The document's light shades fill-extrusion faces from the first
      // frame. A rejected light (setLight validates against the spec) warns
      // and the document keeps rendering under the basemap's light.
      if (options.light) {
        try {
          this.map.setLight(options.light as never);
        } catch (error) {
          console.warn('[maplibre-yaml] `light:` could not be applied:', error);
        }
      }

      // Apply YAML-declared controls and legend once the map is ready.
      // The guards keep manual addControls()/buildLegend() calls made before
      // load from being duplicated here.
      if (options.controls && !this.controlsAdded) {
        this.addControls(options.controls);
      }
      if (options.legendElement && !this.legendBuilt) {
        // The `legend` slot replaces the built-in legend outright.
        this.legendBuilt = true;
        this.chromeLayout().mount(options.legend?.position ?? 'top-left', options.legendElement);
      } else if (options.legend && !this.legendBuilt) {
        this.buildLegend(this.createLegendContainer(options.legend), layers, options.legend);
      }

      // Params/toggle panel (U8, R11) — chrome, so a failure here warns and
      // the document keeps rendering (ml-blj): unlike sources, a broken
      // panel is not a broken map.
      try {
        this.buildParamsPanel(layers, options, setState);
      } catch (error) {
        console.warn('[maplibre-yaml] params panel failed to build:', error);
      }

      // Host chrome (U9 slots) mounts last: built-in pieces keep the corner
      // edge and author children stack after them (KTD10 registration order).
      for (const { position, element } of options.chrome ?? []) {
        this.chromeLayout().mount(position, element);
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

      // Standalone popups (U14): open at their coordinates, same trust gate.
      if (options.popups && options.popups.length > 0) {
        this.popupsManager = new PopupsManager(this.map, options.capabilities);
        this.popupsManager.add(options.popups);
      }

      // An inline-data fit was applied by the constructor; announce it now
      // that listeners (attached after construction) can hear it.
      if (this.mapReadyFit) {
        this.fitApplied = true;
        this.emit('camera:fit', this.mapReadyFit);
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

      // Add layers. Image loading pushes the adds behind network time, so a
      // destroy() during that window (SPA navigation, component unmount) must
      // stop the chain — adding layers to a removed map throws, and reporting
      // that as a fatal document error on a map the host disposed on purpose
      // would be noise.
      imagesReady
        .then(() => {
          if (this.destroyed) return;
          return Promise.all(layers.map((layer) => this.addLayer(layer))).then(() => {
            this.layersAdded = true;
            if (terrainPending && options.terrain) {
              applyTerrain(map3d, options.terrain, true);
            }
            // Panel toggles made while layers were still loading apply now.
            for (const [layerId, visible] of this.pendingVisibility) {
              if (this.map.getLayer(layerId)) {
                this.layerManager.setVisibility(layerId, visible);
                this.emit('layer:visibility', { layerId, visible });
              } else {
                console.warn(
                  `[maplibre-yaml] cannot toggle layer "${layerId}" — it is not on the map.`
                );
              }
            }
            this.pendingVisibility.clear();
            this.emit('load', undefined);
            options.onLoad?.();
          });
        })
        .catch((error) => {
          if (this.destroyed) return;
          options.onError?.(error, true);
        });
    });

    // An image name no declared image or sprite supplies: warn once per
    // name instead of letting MapLibre spam one warning per render. The set
    // is bounded because data-driven icon-image makes the id space
    // feature-data-sized — past the cap, one final note and silence.
    const MISSING_WARN_CAP = 100;
    const missingWarned = new Set<string>();
    this.map.on('styleimagemissing', (e: { id: string }) => {
      if (missingWarned.has(e.id) || missingWarned.size > MISSING_WARN_CAP) return;
      missingWarned.add(e.id);
      if (missingWarned.size > MISSING_WARN_CAP) {
        console.warn(
          `[maplibre-yaml] over ${MISSING_WARN_CAP} distinct missing image names; ` +
            'suppressing further missing-image warnings.'
        );
        return;
      }
      console.warn(
        `[maplibre-yaml] layer references image "${e.id}" but no images: entry, ` +
          'sprite, or addImage call supplies it.'
      );
    });

    // Handle errors. Runtime maplibre error events are non-fatal: the map
    // still reaches `load` after a failed tile/sprite/glyph request.
    // maplibre-gl v6 types `e.error` as `{ message }` (ErrorLike), not
    // Error; normalise so onError's contract holds on every major.
    this.map.on('error', (e) => {
      const raw = e.error as unknown;
      let error =
        raw instanceof Error
          ? raw
          : Object.assign(
              new Error(
                (raw as { message?: unknown } | undefined)?.message != null
                  ? String((raw as { message: unknown }).message)
                  : String(raw)
              ),
              { cause: raw }
            );
      const hinted = withWorkerUrlHint(error.message, runtimeVersion());
      if (hinted !== error.message) error = Object.assign(new Error(hinted), { cause: raw });
      options.onError?.(error, false);
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
    // Version-gated layer types declare absence below their floor (U14,
    // the U8 precedent): one warning per type, the layer skipped, the rest
    // of the document unaffected — instead of MapLibre rejecting it.
    if (!this.supportsLayerType(layer.type)) {
      if (!this.warnedUnsupportedTypes.has(layer.type)) {
        this.warnedUnsupportedTypes.add(layer.type);
        console.warn(
          `[maplibre-yaml] \`${layer.type}\` layers need maplibre-gl ` +
            `${COLOR_RELIEF_RUNTIME_FLOOR} or later (running ${this.mapVersion()}); ` +
            `skipping layer "${layer.id}" and any other ${layer.type} layers.`
        );
      }
      return;
    }
    await this.layerManager.addLayer(layer);
    this.eventHandler.attachEvents(layer);
    this.emit('layer:added', { layerId: layer.id });
  }

  /** The running maplibre-gl version, as best the runtime reports it. */
  private mapVersion(): string | undefined {
    const fromMap = (this.map as unknown as { version?: unknown }).version;
    return typeof fromMap === 'string' ? fromMap : runtimeVersion();
  }

  /**
   * Whether the running maplibre-gl can render a layer type. Only
   * `color-relief` is gated today (5.6+). An unknown version is not a claim
   * — the layer is attempted and MapLibre has the final word.
   */
  private supportsLayerType(type: string): boolean {
    if (type !== 'color-relief') return true;
    const version = this.mapVersion();
    return version === undefined || meetsVersion(version, COLOR_RELIEF_RUNTIME_FLOOR);
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
   * Build the params/toggle panel (U8, R11): `parameters:` metadata joined
   * with `state:` defaults, plus visibility checkboxes for layers with an
   * authored `label:` whose `toggleable` is not false. The label gate is
   * deliberate — `toggleable` defaults to true on every layer, so listing
   * all toggleable layers would put chrome on every map ever written; an
   * authored display label is the document saying "this layer is
   * user-facing". Registered top-right in the corner system (KTD10).
   */
  private buildParamsPanel(
    layers: Layer[],
    options: MapRendererOptions,
    setState: ((name: string, value: unknown) => void) | undefined
  ): void {
    if (this.paramsBuilt) return;
    const toggleableLayers = layers.flatMap((layer) => {
      const l = layer as unknown as Record<string, unknown>;
      if (typeof l['label'] !== 'string' || l['toggleable'] === false) return [];
      // Hidden is hidden however it was spelled: `visible: false` or the
      // spec-native `layout: { visibility: "none" }` passthrough.
      const layout = l['layout'] as Record<string, unknown> | undefined;
      return [
        {
          id: String(l['id']),
          label: l['label'],
          visible: l['visible'] !== false && layout?.['visibility'] !== 'none',
        },
      ];
    });
    const panelConfig: ParamsPanelConfig = {
      ...(options.parameters
        ? { parameters: options.parameters as Record<string, ParameterMeta> }
        : {}),
      ...(options.state ? { state: options.state } : {}),
      toggleableLayers,
      stateSupported: typeof setState === 'function',
    };
    if (!hasPanelContent(panelConfig)) return;

    this.paramsBuilt = true;
    const mount = document.createElement('div');
    this.chromeLayout().mount('top-right', mount);
    new ParamsBuilder().build(mount, panelConfig, {
      onStateChange: (key, value) => {
        if (this.destroyed) return;
        try {
          setState?.call(this.map, key, value);
        } catch (error) {
          // A host setStyle() in flight makes MapLibre throw "Style is not
          // done loading" — a dropped write during a swap, not a crash.
          console.warn('[maplibre-yaml] state write dropped:', error);
          return;
        }
        this.emit('parameter:change', { key, value });
      },
      onToggleLayer: (layerId, visible) => {
        if (this.destroyed) return;
        // The panel is interactive before the layer chain settles (images
        // load first) — a toggle made in that window is DEFERRED, not
        // dropped; one made against a layer that never landed warns.
        if (!this.map.getLayer(layerId)) {
          if (this.layersAdded) {
            console.warn(
              `[maplibre-yaml] cannot toggle layer "${layerId}" — it is not on the map.`
            );
            return;
          }
          this.pendingVisibility.set(layerId, visible);
          return;
        }
        this.layerManager.setVisibility(layerId, visible);
        this.emit('layer:visibility', { layerId, visible });
      },
    });
    if (
      Object.keys(panelConfig.parameters ?? {}).length > 0 &&
      typeof setState !== 'function'
    ) {
      console.warn(
        '[maplibre-yaml] this document declares `parameters:`, but the ' +
          'running maplibre-gl has no setGlobalStateProperty (needs >= 5.6); ' +
          'the panel shows a notice instead of controls.',
      );
    }
  }

  /** The shared corner system (KTD10), created on first chrome mount. */
  private chromeLayout(): ChromeLayout {
    if (!this.chrome) {
      this.chrome = new ChromeLayout(this.containerEl ?? this.map.getContainer());
    }
    return this.chrome;
  }

  /**
   * Create a container for the auto legend, registered into the shared
   * corner system (KTD10) — same placement contract as the params panel
   * and (U9) author slots; same-corner occupants stack.
   */
  private createLegendContainer(config: LegendConfig): HTMLElement {
    const el = document.createElement('div');
    el.className = 'ml-map-legend';
    this.chromeLayout().mount(config.position ?? 'top-left', el);
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
    this.destroyed = true;
    this.markersManager?.destroy();
    this.markersManager = null;
    this.popupsManager?.destroy();
    this.popupsManager = null;
    this.controlsManager.removeAllControls();
    this.autoLegendContainer?.remove();
    this.autoLegendContainer = null;
    this.chrome?.destroy();
    this.chrome = null;
    this.eventListeners.clear();
    this.attributionGuard.dispose();
    this.map.remove();
  }
}
