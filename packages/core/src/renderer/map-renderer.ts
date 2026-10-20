/**
 * @file Main map renderer for MapLibre YAML
 * @module @maplibre-yaml/core/renderer
 */

import type { LngLat } from 'maplibre-gl';
import { Map as MapLibreMap, AttributionControl, runtimeVersion, withWorkerUrlHint } from './maplibre-interop';
import { installAttributionGuard, type AttributionGuard } from './attribution-guard';
import { sanitizeCustomAttribution, sanitizeSourcesAttribution } from '../utils/attribution';
import { createImageRefs, noteImageValue, noteLayerImageRefs } from '../utils/image-refs';
import { suggest } from '../utils/suggest';
import type { z } from 'zod';
import { MapConfigSchema, LayerSchema, LayerSourceSchema, ControlsConfigSchema, LegendConfigSchema } from '../schemas';
import {
  LayerManager,
  type LayerManagerCallbacks,
  type LayerManagerDataOptions,
} from './layer-manager';
import { EventHandler, type EventHandlerCallbacks } from './event-handler';
import { LegendBuilder } from './legend-builder';
import { ClassifyRuntime } from './classify-runtime';
import { effectiveLegend, type ClassifyRecord } from '../classify/compile';

/** The legend a classified map gets when it declares none: the schema's defaults. */
const AUTO_LEGEND = { position: 'top-left', collapsed: false } as const satisfies Partial<LegendConfig>;
import type { MarkerConfig, StandalonePopupConfig, FitToConfig } from '../schemas/map.schema';
import { ControlsManager } from './controls-manager';
import { MarkersManager } from './markers-manager';
import { PopupsManager } from './popups-manager';
import { geojsonBounds, type Bounds } from '../interactions/geometry-bounds';
import { swappedCenter } from '../utils/swapped-center';
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
import { createStrings, type Strings } from '../i18n';
import { mapLanguage } from './popup-builder';
import { applyAccessibleName } from './accessible-name';
import { isProtocolRegistered, prepareProtocols } from './cloud-protocols';
import { formatOfSource, type CloudFormat } from '../formats/detect';

/** The document's source ids (named, and `<layer>-source` for inline ones) that read `format`. */
function sourceIdsReading(
  format: CloudFormat,
  sources: Record<string, unknown> | undefined,
  layers: Layer[]
): string[] {
  const ids = Object.entries(sources ?? {})
    .filter(([, source]) => formatOfSource(source) === format)
    .map(([id]) => id);
  for (const layer of layers) {
    const source = (layer as { source?: unknown }).source;
    if (source && typeof source === 'object' && formatOfSource(source) === format) {
      ids.push(`${layer.id}-source`);
    }
  }
  return ids;
}
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
  | { kind: 'unsupported'; reason: string; missing?: { suggestion?: string } };

function resolveFitTo(
  fitTo: FitToConfig,
  sources: Record<string, unknown> | undefined
): FitResolution {
  const keep = 'keeping the authored center/zoom.';
  const source = sources?.[fitTo.source] as Record<string, unknown> | undefined;
  if (!source || typeof source !== 'object') {
    const suggestion = suggest(fitTo.source, Object.keys(sources ?? {}));
    return {
      kind: 'unsupported',
      reason:
        `fitTo.source "${fitTo.source}" names no entry in \`sources:\`` +
        (suggestion ? ` — did you mean "${suggestion}"?` : '') +
        ` (inline layer sources cannot be named — move it to \`sources:\`); ${keep}`,
      missing: { suggestion },
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
 * What part of the document a reported error belongs to — the third argument
 * of {@link MapRendererOptions.onError}.
 *
 * @remarks
 * - `style`: the basemap style never loaded (a 404/403/CORS failure, a URL
 *   that is not a style, an invalid inline style). Always fatal: no layer can
 *   draw without it.
 * - `layer`: one document layer was rejected or could not be added (a bad
 *   paint value, a `source:` naming a source that does not exist). The rest
 *   of the map keeps working.
 * - `source`: one document source failed at runtime (tiles or a TileJSON
 *   that would not load).
 * - `classify`: a classified layer's computed breaks can't be computed (its
 *   source is read by view); the layer draws in its no-data colour.
 *
 * Errors with no context (a basemap tile, a glyph) are not the document's.
 */
export interface MapErrorContext {
  /**
   * `fit`: `config.fitTo.source` names no source; the map keeps its authored
   * camera. `center`: `config.center` looks written [latitude, longitude] —
   * far from the document's data, while the swapped pair lands on it.
   * `classify`: a layer's computed classes (`method:`) can't be computed,
   * because its source holds only the features in view; the layer draws in
   * its no-data colour. The error message is the whole notice.
   */
  kind: 'style' | 'layer' | 'source' | 'fit' | 'center' | 'classify';
  /** For `center`: the center as written. */
  center?: [number, number];
  /** The document layer, for `layer` and `classify` errors. */
  layerId?: string;
  /** The document source, for `source` errors; the name `fitTo.source` gave, for `fit`. */
  sourceId?: string;
  /** For `fit`: the closest source name, when one is close. */
  suggestion?: string;
  /** For `center`: the swapped pair, [longitude, latitude]. */
  swapped?: [number, number];
  /** The style URL, for `style` errors when the style was given as a URL. */
  url?: string;
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
   * second argument, so existing single-arg callbacks are unaffected. The
   * optional third, {@link MapErrorContext}, says which part of the document
   * failed — the basemap style (fatal), one layer, or one source — or is
   * absent for errors that are not the document's (a basemap tile).
   */
  onError?: (error: Error, fatal?: boolean, context?: MapErrorContext) => void;
  /**
   * The map's name (the document's `title:`): the canvas's accessible name,
   * in place of MapLibre's generic `locale["Map.Title"]` ("Map").
   */
  title?: string;
  /**
   * What the map shows (the document's `description:`): a visually hidden
   * element the canvas points at with `aria-describedby`.
   */
  description?: string;
  /** Controls declared in the YAML `controls:` block — added automatically on map load */
  controls?: ControlsConfig;
  /**
   * Legend declared in the YAML `legend:` block — built automatically on map
   * load. Absent with a `classify:` layer: an automatic legend; `false`: none.
   */
  legend?: LegendConfig | false;
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
  /**
   * Data loading the host already started for named sources (ml-aot.75):
   * `<ml-map>` fetches a `fitTo` source's `url:` before it builds the map,
   * and hands the load over here so the source's first load awaits it
   * instead of fetching again (one request), through the same fetcher and
   * cache. Optional; without it every source loads itself, as before.
   */
  sourceData?: LayerManagerDataOptions;
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
  /**
   * A `classify:` layer's classes, as drawn: once when the layers settle,
   * and again whenever fetched data (re)computes them.
   */
  'layer:classified': { layerId: string; classify: ClassifyRecord };
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
  /** A label layer had no text-font and the basemap named none (ml-aot.53). */
  private warnedNoTextFont = false;
  /** Image names the document's own layers can ask for (ml-aot.37). */
  private imageRefs = createImageRefs();
  private controlsManager: ControlsManager;
  private attributionGuard: AttributionGuard;
  private eventListeners: Map<string, Set<Function>>;
  private isLoaded: boolean;
  private containerEl: HTMLElement | null;
  private controlsAdded: boolean;
  private legendBuilt: boolean;
  private paramsBuilt = false;
  /**
   * The library's UI strings for this document (`config.locale`, the same
   * table MapLibre reads for its controls).
   */
  private readonly strings: Strings;
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
  /** ml-aot.65: check `config.center` against the document's inline data, on load. */
  private checkInlineCenter: (() => void) | null = null;
  private autoLegendContainer: HTMLElement | null;
  /** `classify:` layers whose breaks come from fetched data (0.9). */
  private classify: ClassifyRuntime | null = null;
  /** Where buildLegend() last drew, so classify can redraw it. */
  private legendTarget: { container: string | HTMLElement; layers: Layer[]; config?: LegendConfig } | null = null;


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
    // One `locale:` table for MapLibre's controls and the library's own
    // strings (namespaced `maplibre-yaml.*`, which MapLibre ignores).
    this.strings = createStrings(config.locale);

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

    // Cloud-native formats (ml-cnv): register the protocols this document's
    // sources need (PMTiles) on the module the map is built from. Started
    // before the map exists — never blocking it: the basemap loads in
    // parallel — and awaited in the load handler, before the document's own
    // sources are added (the first point anything reads them).
    const formatsReady = prepareProtocols(sources, layers, mapStyle);

    // The document's `title:` is the map's accessible name. MapLibre names
    // its canvas from `locale["Map.Title"]`, so hand it the title there too:
    // MapLibre and the attribute set below then agree.
    const authorLocale = (config as { locale?: unknown }).locale;
    const locale =
      typeof options.title === 'string' && options.title.trim() !== ''
        ? {
            ...(authorLocale && typeof authorLocale === 'object' ? (authorLocale as Record<string, unknown>) : {}),
            'Map.Title': options.title,
          }
        : authorLocale;

    // Initialize MapLibre map
    this.map = new MapLibreMap({
      ...mapConfig,
      ...(locale !== undefined ? { locale } : {}),
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
    // Accessible name and description on the canvas (every supported
    // maplibre-gl major; MapLibre's own role/label are extended, not fought).
    applyAccessibleName(this.map, {
      ...(options.title !== undefined ? { title: options.title } : {}),
      ...(options.description !== undefined ? { description: options.description } : {}),
      strings: this.strings,
    });
    if (fitTo && fit && fit.kind === 'bounds') {
      this.mapReadyFit = { source: fitTo.source, bounds: fit.bounds };
    }
    // A fitTo.source typo leaves the map on its authored camera with only a
    // console line; tell the host too, so <ml-map> can say so on the page
    // (ml-aot.51). On load, when the host's notice has a map to sit on.
    if (fitTo && fit && fit.kind === 'unsupported' && fit.missing) {
      const missing = fit.missing;
      let reported = false;
      this.map.on('load', () => {
        if (reported || this.destroyed) return;
        reported = true;
        options.onError?.(new Error(fit.reason), false, {
          kind: 'fit',
          sourceId: fitTo.source,
          ...(missing.suggestion ? { suggestion: missing.suggestion } : {}),
        });
      });
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
    // `center: [lat, lng]` (ml-aot.65): once the document's data is known,
    // a center far from it whose swapped pair lands on it is reported (once).
    // Not when fitTo or bounds frame the camera: the center is not used then.
    let dataBounds: Bounds | null = null;
    let centerChecked = Boolean(fitTo) || (config as { bounds?: unknown }).bounds !== undefined;
    const unionBounds = (add: Bounds | null) => {
      if (!add) return;
      dataBounds = dataBounds
        ? [
            [Math.min(dataBounds[0][0], add[0][0]), Math.min(dataBounds[0][1], add[0][1])],
            [Math.max(dataBounds[1][0], add[1][0]), Math.max(dataBounds[1][1], add[1][1])],
          ]
        : add;
    };
    const inlineData = (source: unknown): unknown => {
      if (!source || typeof source !== 'object') return undefined;
      const s = source as Record<string, unknown>;
      return s['data'] && typeof s['data'] === 'object' ? s['data'] : s['prefetchedData'];
    };
    const checkCenter = () => {
      if (centerChecked || this.destroyed || !dataBounds) return;
      const swapped = swappedCenter(config.center, dataBounds);
      if (!swapped) return;
      centerChecked = true;
      const center = config.center as [number, number];
      console.warn(
        `[maplibre-yaml] config.center [${center[0]}, ${center[1]}] is far from this map's data, ` +
          `but [${swapped[0]}, ${swapped[1]}] is on it. Coordinates are [longitude, latitude].`
      );
      options.onError?.(new Error('config.center looks like [latitude, longitude]'), false, {
        kind: 'center',
        center: [center[0], center[1]],
        swapped,
      });
    };
    const checkInlineCenter = () => {
      for (const source of Object.values(sources ?? {})) unionBounds(geojsonBounds(inlineData(source) ?? null));
      for (const layer of layers) {
        const source = (layer as { source?: unknown }).source;
        if (source && typeof source === 'object') unionBounds(geojsonBounds(inlineData(source) ?? null));
      }
      checkCenter();
    };
    this.checkInlineCenter = checkInlineCenter;

    const layerCallbacks: LayerManagerCallbacks = {
      onDataLoading: (layerId) => this.emit('layer:data-loading', { layerId }),
      onDataLoaded: (layerId, featureCount) => {
        // Computed classify breaks follow the data (first load and refresh).
        try {
          this.classify?.dataLoaded(layerId);
        } catch (error) {
          console.warn(`[maplibre-yaml] classify on layer "${layerId}" failed:`, error);
        }
        // A fetched `fitTo` source frames the camera on its FIRST load only:
        // after that the user owns the camera, and a refresh must not yank it.
        if (fitTo && fit && fit.kind === 'deferred' && !this.fitApplied) {
          const data = this.layerManager.getSourceData(fitTo.source);
          // A source read by view (FlatGeobuf `load: viewport`, ml-cnv.3)
          // holds only the part in view: frame the file's own extent.
          const bounds =
            this.layerManager.getSourceExtent?.(fitTo.source) ??
            (data ? geojsonBounds(data) : null);
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
        if (!centerChecked) {
          // Advisory only: never let it get in the way of the data load.
          try {
            const sourceId = this.layerManager.getSourceIdForLayer?.(layerId);
            const data = sourceId ? this.layerManager.getSourceData?.(sourceId) : undefined;
            unionBounds(data ? geojsonBounds(data) : null);
            checkCenter();
          } catch {
            /* the center check is a hint; skip it */
          }
        }
        this.emit('layer:data-loaded', { layerId, featureCount });
      },
      onDataError: (layerId, error) => this.emit('layer:data-error', { layerId, error }),
      // A source in a format this version can't read (ml-cnv): reported
      // once, against the source, like any non-fatal source failure.
      onSourceError: (sourceId, error) => {
        console.warn(`[maplibre-yaml] ${error.message.replace(/`/g, '"')}`);
        options.onError?.(error, false, { kind: 'source', sourceId });
      },
    };

    const eventCallbacks: EventHandlerCallbacks = {
      onClick: (layerId, feature, lngLat) => this.emit('layer:click', { layerId, feature, lngLat }),
      onHover: (layerId, feature, lngLat) => this.emit('layer:hover', { layerId, feature, lngLat }),
    };

    this.layerManager = new LayerManager(this.map, layerCallbacks, {
      ...options.sourceData,
      isProtocolRegistered,
    });
    const classifyRuntime = new ClassifyRuntime(
      this.map,
      layers as never,
      sources as Record<string, unknown> | undefined,
      (sourceId) => this.layerManager.getSourceData?.(sourceId),
      (layerId, record) => {
        this.redrawLegend();
        this.emit('layer:classified', { layerId, classify: record });
      },
      {
        readsByView: (sourceId) => this.layerManager.readsByView?.(sourceId) ?? false,
        onRefused: (layerId, sourceId, error) => {
          console.warn(`[maplibre-yaml] ${error.message.replace(/`/g, '"')}`);
          options.onError?.(error, false, { kind: 'classify', layerId, sourceId });
        },
      }
    );
    if (classifyRuntime.active) this.classify = classifyRuntime;
    this.eventHandler = new EventHandler(this.map, eventCallbacks, options.capabilities);
    this.legendBuilder = new LegendBuilder({ strings: this.strings });
    this.controlsManager = new ControlsManager(this.map, {
      ...(options.terrain ? { terrain: options.terrain } : {}),
      beforeAttribution: () => this.attributionGuard.scrub(),
    });

    // Set up load handler. With cloud-native sources, the document's sources
    // wait for their readers (ml-cnv) — a microtask while the decoders are
    // bundled; a reader that failed to set up skips its sources with a
    // notice and everything else renders.
    this.map.on('load', () => {
      if (!formatsReady) {
        onStyleLoaded();
        return;
      }
      void formatsReady.then((failed) => {
        if (this.destroyed) return;
        for (const [format, error] of failed) {
          for (const sourceId of sourceIdsReading(format, sources, layers)) {
            options.onError?.(error, false, { kind: 'source', sourceId });
          }
        }
        onStyleLoaded();
      });
    });
    const onStyleLoaded = () => {
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
      // A classified map without a `legend:` block gets one (0.9).
      const legend = effectiveLegend(options.legend, layers, AUTO_LEGEND);
      if (options.legendElement && !this.legendBuilt) {
        // The `legend` slot replaces the built-in legend outright.
        this.legendBuilt = true;
        this.chromeLayout().mount(legend?.position ?? 'top-left', options.legendElement);
      } else if (legend && !this.legendBuilt) {
        this.buildLegend(this.createLegendContainer(legend), layers, legend);
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

      // A narrow map opens MapLibre's compact attribution expanded, across
      // a bottom-left legend/slot (ml-aot.26) or scale bar (ml-aot.38):
      // start it collapsed instead, and again if a resize (phone rotation)
      // re-expands it. (Constructing the layout touches no DOM.)
      const chrome = this.chromeLayout();
      chrome.collapseCompactAttribution();
      this.map.on('resize', () => this.chrome?.collapseCompactAttribution());

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
          // One layer failing to add (a `source:` that names nothing) is a
          // layer problem, not a document one: report it against the layer
          // and let the rest of the map load (ml-aot.15). It used to reject
          // the whole document — the basemap stayed up, every other layer
          // drew, but `load` never fired and nothing said which layer broke.
          const addOne = (layer: Layer) =>
            this.addLayer(layer).catch((error: unknown) => {
              if (this.destroyed) return;
              options.onError?.(
                error instanceof Error ? error : new Error(String(error)),
                false,
                { kind: 'layer', layerId: layer.id }
              );
            });
          return Promise.all(layers.map(addOne)).then(() => {
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
            this.checkInlineCenter?.();
            if (this.classify) {
              // Tell listeners (a story's pinned legend) the classes as drawn,
              // then catch up: data that landed before its layer was added,
              // and `data:` URLs MapLibre fetches by itself.
              for (const [layerId, record] of this.classify.records()) {
                this.emit('layer:classified', { layerId, classify: record });
              }
              void this.classify.layersReady();
            }
            this.emit('load', undefined);
            options.onLoad?.();
          });
        })
        .catch((error) => {
          if (this.destroyed) return;
          options.onError?.(error, true);
        });
    };

    // An image name no declared image or sprite supplies: warn once per
    // name instead of letting MapLibre spam one warning per render. The set
    // is bounded because data-driven icon-image makes the id space
    // feature-data-sized — past the cap, one final note and silence.
    const MISSING_WARN_CAP = 100;
    for (const layer of layers) noteLayerImageRefs(this.imageRefs, layer);
    const missingWarned = new Set<string>();
    const warnMissing = (id: string) => {
      if (missingWarned.has(id) || missingWarned.size > MISSING_WARN_CAP) return;
      missingWarned.add(id);
      if (missingWarned.size > MISSING_WARN_CAP) {
        console.warn(
          `[maplibre-yaml] over ${MISSING_WARN_CAP} distinct missing image names; ` +
            'suppressing further missing-image warnings.'
        );
        return;
      }
      // MapLibre does not say which layer asked; only blame the document for
      // a name its own layers can produce (ml-aot.37). A basemap icon the
      // basemap's sprite lacks is MapLibre's own console warning already.
      if (this.imageRefs.names.has(id)) {
        console.warn(
          `[maplibre-yaml] layer references image "${id}" but no images: entry, ` +
            'sprite, or addImage call supplies it.'
        );
      } else if (this.imageRefs.dynamic) {
        console.warn(
          `[maplibre-yaml] image "${id}" is missing. If one of your layers builds ` +
            'its icon name from feature data, add this image under images:; if it ' +
            "is a basemap icon, the basemap's sprite lacks it and you can ignore this."
        );
      }
    };
    this.map.on('styleimagemissing', (e: { id: string }) => {
      if (missingWarned.has(e.id) || missingWarned.size > MISSING_WARN_CAP) return;
      // A page's own styleimagemissing handler may supply the image (the
      // generate-a-missing-icon pattern, U16). Listeners run synchronously
      // in registration order and this one registered first, so defer the
      // verdict until every listener has had its turn.
      const map = this.map;
      queueMicrotask(() => {
        if (this.destroyed || map?.hasImage(e.id)) return;
        warnMissing(e.id);
      });
    });

    // Which runtime errors belong to the document: its own layers (named
    // in MapLibre's validation messages, or on the event) and its own
    // sources (named sources, plus the `<layer>-source` an inline one gets).
    const documentLayerIds = layers.map((layer) => layer.id);
    const documentSourceIds = new Set<string>([
      ...Object.keys(sources ?? {}),
      ...layers
        .filter((layer) => layer.source && typeof layer.source === 'object')
        .map((layer) => `${layer.id}-source`),
    ]);
    const styleUrl = typeof config.mapStyle === 'string' ? config.mapStyle : undefined;
    let styleLoaded = false;
    this.map.on('style.load', () => {
      styleLoaded = true;
    });
    const classify = (
      e: { sourceId?: unknown; tile?: unknown; layer?: { id?: unknown } },
      message: string
    ): MapErrorContext | undefined => {
      // Before the style has loaded, an error that is not about a source
      // or tile is the style itself failing: a 404/403, a CORS refusal, a
      // URL that returned something other than style JSON, or style
      // validation. MapLibre never fires `load` after it (ml-aot.14).
      if (!styleLoaded && !this.isLoaded && e.sourceId === undefined && e.tile === undefined) {
        if (/worker failed to load/i.test(message)) return undefined;
        return { kind: 'style', ...(styleUrl ? { url: styleUrl } : {}) };
      }
      const eventLayer = typeof e.layer?.id === 'string' ? e.layer.id : undefined;
      const layerId =
        (eventLayer && documentLayerIds.includes(eventLayer) ? eventLayer : undefined) ??
        documentLayerIds.find(
          (id) => message.startsWith(`layers.${id}.`) || message.startsWith(`layers.${id}:`)
        );
      if (layerId) return { kind: 'layer', layerId };
      if (typeof e.sourceId === 'string' && documentSourceIds.has(e.sourceId)) {
        return { kind: 'source', sourceId: e.sourceId };
      }
      return undefined;
    };

    // Handle errors. Runtime maplibre error events are non-fatal — the map
    // still reaches `load` after a failed tile/sprite/glyph request — except
    // a basemap style that never loaded (classified above).
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
      const context = classify(e as never, error.message);
      // A basemap style that never loads is fatal: without it no layer can
      // draw and `load` never fires.
      options.onError?.(error, context?.kind === 'style', context);
    });
  }

  /**
   * Get the underlying MapLibre map instance
   */
  getMap(): MapLibreMap {
    return this.map;
  }

  /**
   * Record an image property value the document sets at runtime (a story's
   * `setLayoutProperty` action, for example), so a missing image it names is
   * reported as the document's, not dismissed as a basemap sprite gap.
   * Values of non-image properties are ignored.
   *
   * @param property - The layout/paint property (`icon-image`, `fill-pattern`, …).
   * @param value - Its value: a name, a `{token}` string, or an expression.
   */
  noteImageReference(property: string, value: unknown): void {
    noteImageValue(this.imageRefs, property, value);
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
    noteLayerImageRefs(this.imageRefs, layer);
    // A layer added after load may bring its own PMTiles source (ml-cnv).
    const formatsReady = prepareProtocols(undefined, [layer]);
    if (formatsReady) {
      const failed = await formatsReady;
      const [first] = failed.values();
      if (first) throw first;
    }
    layer = this.withBasemapTextFont(layer);
    await this.layerManager.addLayer(layer);
    this.eventHandler.attachEvents(layer);
    this.emit('layer:added', { layerId: layer.id });
  }

  /**
   * A label layer with no `text-font` gets the basemap's own font stack
   * (ml-aot.53). MapLibre's default ("Open Sans Regular, Arial Unicode MS
   * Regular") is missing from most basemaps' glyphs (OpenFreeMap serves Noto
   * Sans), which floods the console with glyph 404s and one warning per
   * character. When the basemap names no font, warn once with the fix.
   */
  private withBasemapTextFont(layer: Layer): Layer {
    if (layer.type !== 'symbol') return layer;
    const layout = (layer as { layout?: Record<string, unknown> }).layout;
    if (!layout || layout['text-field'] === undefined || layout['text-font'] !== undefined) return layer;
    const font = this.basemapTextFont();
    if (font) return { ...layer, layout: { ...layout, 'text-font': font } } as Layer;
    if (!this.warnedNoTextFont) {
      this.warnedNoTextFont = true;
      console.warn(
        `[maplibre-yaml] layer "${layer.id}" shows text but has no text-font, and the ` +
          `basemap names no font to borrow, so MapLibre asks the glyphs server for its ` +
          `default font. Add text-font: ["<a font your glyphs: URL serves>"] to the ` +
          `layer's layout (OpenFreeMap: "Noto Sans Regular").`
      );
    }
    return layer;
  }

  /**
   * The basemap font stack to borrow: the first plain stack that is all
   * "Regular" faces, else the stack its labels use most (ml-aot.61). Not
   * simply the first: OpenFreeMap Liberty's first label layer is a water
   * label in Noto Sans Italic, which made every borrowed label italic.
   */
  private basemapTextFont(): string[] | undefined {
    let layers: Array<{ layout?: Record<string, unknown> }> = [];
    try {
      layers = ((this.map as unknown as { getStyle?: () => { layers?: unknown[] } })
        .getStyle?.()?.layers ?? []) as typeof layers;
    } catch {
      return undefined;
    }
    const stacks: string[][] = [];
    for (const styleLayer of layers) {
      let font = styleLayer?.layout?.['text-font'];
      if (Array.isArray(font) && font[0] === 'literal') font = font[1];
      if (Array.isArray(font) && font.length > 0 && font.every((f) => typeof f === 'string')) {
        stacks.push([...(font as string[])]);
      }
    }
    if (stacks.length === 0) return undefined;
    const regular = stacks.find((stack) => stack.every((f) => /regular/i.test(f)));
    if (regular) return regular;
    const counts = new Map<string, { stack: string[]; n: number }>();
    for (const stack of stacks) {
      const key = stack.join('\u0000');
      const entry = counts.get(key) ?? { stack, n: 0 };
      entry.n += 1;
      counts.set(key, entry);
    }
    let best: { stack: string[]; n: number } | undefined;
    for (const entry of counts.values()) if (!best || entry.n > best.n) best = entry;
    return best?.stack;
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
    this.legendTarget = { container, layers, ...(config ? { config } : {}) };
    this.legendBuilder.build(container, layers, config);
  }

  /**
   * Redraw the legend buildLegend() drew, after a `classify:` layer's classes
   * changed (computed breaks landed, a refresh moved them). A legend the
   * host replaced through the `legend` slot is the host's to update.
   */
  private redrawLegend(): void {
    const target = this.legendTarget;
    if (!target || this.destroyed) return;
    const el =
      typeof target.container === 'string' ? document.getElementById(target.container) : target.container;
    // Keep the reader's open/closed choice across a redraw (a refresh).
    const open = el?.querySelector('details')?.open;
    this.legendBuilder.build(target.container, target.layers, target.config);
    const details = el?.querySelector('details');
    if (details && open !== undefined) details.open = open;
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
    new ParamsBuilder({
      strings: this.strings,
      language: mapLanguage(this.map),
    }).build(mount, panelConfig, {
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
    this.classify?.destroy();
    this.classify = null;
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
