/**
 * @file Main map renderer for MapLibre YAML
 * @module @maplibre-yaml/core/renderer
 */

import { consoleText } from "../utils/console-text";
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
import type {
  AppliedDocument,
  DiffHints,
  DocumentOptions,
  RejectionKind,
  RuntimeHost,
  UpdateHost,
  UpdateResult,
  UpdateSummary,
} from './update/types';
import { getDecoder } from '../formats/decoders';
import { createStrings, type Strings } from '../i18n';
import { mapLanguage } from './popup-builder';
import { applyAccessibleName } from './accessible-name';
import { isProtocolRegistered, pmtilesUnavailable, prepareProtocols } from './cloud-protocols';
import { cogHintFor } from '../formats/cog-protocol';
import { basemapRequestTransformer, type RequestTransformer } from './basemap-urls';
import { formatOfSource, type CloudFormat } from '../formats/detect';
import { protomapsBasemapOf, type ProtomapsBasemap } from '../schemas/basemap.schema';
import {
  basemapAssetMessage,
  ensureRightToLeftLabels,
  probeBasemapAssets,
  type BasemapAssets,
} from './basemap-assets';
import {
  ATTRIBUTION_RESERVE_NARROW,
  ATTRIBUTION_RESERVE_WIDE,
  bottomControlsReserve,
  fitToPadding,
  NARROW_MAP_WIDTH,
  type FitPadding,
} from '../utils/fit-padding';
import { archiveMetadata } from '../formats/pmtiles';
import {
  basemapLanguage,
  fallbackBasemapStyle,
  notAProtomapsBasemap,
  olderProtomapsSchema,
  prefetchProtomapsBasemap,
  PROTOMAPS_SOURCE_ID,
  protomapsStyle,
} from '../formats/protomaps-style';
import { elementLanguage } from '../i18n/strings';
import { geoParquetColumns } from '../formats/columns';
import { namedSourcesNeedingIds } from './highlight-paint';

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

/** The reader's "zoom in" line's class (see `MapRenderer.showZoomIn`). */
export const ZOOM_IN_CLASS = 'ml-map-zoom-in';

/**
 * The line's stylesheet, once per document: theme-aware colours (the page's
 * `color-scheme` through `Canvas` / `CanvasText`, or the author's custom
 * properties), and hidden under `[quiet]` — read live, since it is CSS.
 */
function ensureZoomInStyles(doc: Document): void {
  const id = 'ml-map-zoom-in-styles';
  if (doc.getElementById(id)) return;
  const style = doc.createElement('style');
  style.id = id;
  style.textContent =
    `.${ZOOM_IN_CLASS}{position:absolute;bottom:36px;left:50%;transform:translateX(-50%);z-index:4;` +
    'box-sizing:border-box;max-width:calc(100% - 24px);padding:4px 12px;border-radius:14px;' +
    'background:var(--ml-map-zoom-in-background,Canvas);color:var(--ml-map-zoom-in-color,CanvasText);' +
    'font:13px/1.4 system-ui,-apple-system,sans-serif;text-align:center;' +
    'box-shadow:0 1px 4px rgba(0,0,0,.3);pointer-events:none}' +
    `[quiet] .${ZOOM_IN_CLASS}{display:none}`;
  (doc.head ?? doc.documentElement).append(style);
}

/**
 * How a `fitTo` (U14) resolves against the document's named sources.
 *
 * - `bounds` — inline data: known before the map exists.
 * - `deferred` — a fetched geojson source: fit on its first data load.
 * - `tile-bounds` — a COG (ml-cnv.2): fit to the extent its reader reports
 *   once the source's metadata loads.
 * - `unsupported` — missing name, non-geojson source, or empty data: the
 *   authored center/zoom stand, with one warning naming why.
 */
type FitResolution =
  | { kind: 'bounds'; bounds: Bounds }
  | { kind: 'deferred' }
  | { kind: 'tile-bounds' }
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
  if (
    (source['type'] === 'raster' || source['type'] === 'raster-dem') &&
    formatOfSource(source) === 'cog'
  ) {
    return { kind: 'tile-bounds' };
  }
  if (source['type'] !== 'geojson') {
    return {
      kind: 'unsupported',
      reason:
        `fitTo.source "${fitTo.source}" is a ${String(source['type'])} source; only ` +
        `GeoJSON sources and COGs have an extent to fit (other tiled sources do not); ${keep}`,
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
 * The reader's own plain-language failures (formats/errors), as they reach an
 * `error` event from a style's PMTiles (or COG) source — the file's, and the
 * reader's own: a reader file that couldn't be downloaded (`chunks/pmtiles.js`
 * offline, blocked, or missing from a self-hosted copy) or set up. A tile
 * error crosses MapLibre's worker boundary as a plain error, so the wording
 * is what is matched.
 */
const BASEMAP_FILE_FAILURE =
  /^`[^`]+` (didn't load \(|was served without range-request support|isn't a |is compressed|couldn't be read as )|^The browser couldn't read `|^The [^`]+? reader (\(`[^`]+`\) couldn't be downloaded|couldn't be set up)/;

/** MapLibre's error for a style layer whose `source-layer` the Protomaps file lacks. */
const MISSING_PROTOMAPS_LAYER = new RegExp(
  `^Source layer "[^"]*" does not exist on source "${PROTOMAPS_SOURCE_ID}"`
);

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
 * - `classify-field`: a hint — a classified layer's field has no usable
 *   value in the loaded data, so every feature draws as no data.
 * - `layer-hint`: a hint — a layer was added, but not as written (a
 *   `before:` naming no layer on the map: it went on top).
 * - `source-hint`: a hint — a source draws, but its file is served in a
 *   way that makes it slow (a GeoTIFF that isn't cloud-optimized), or its
 *   live `merge` updates carry features with no `updateKey`.
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
   * `classify-field`: an author hint, not a failure — the loaded data has no
   * usable value for a classified layer's `field:` / `normalize:` (a
   * misspelt or wrong-case name, or text under numeric classes).
   * `basemap`: the basemap loaded, but something about it is wrong (a
   * Protomaps basemap `pmtiles:` file that is some other kind of PMTiles).
   * The error message is the whole notice.
   * `source-hint`: an author hint, not a failure — a source draws, but its
   * file could be served better (a GeoTIFF that isn't cloud-optimized), or
   * its live `merge` updates carry features with no `updateKey` (kept, not
   * matched).
   */
  kind:
    | 'style'
    | 'layer'
    | 'source'
    | 'fit'
    | 'center'
    | 'classify'
    | 'classify-field'
    | 'basemap'
    | 'source-hint'
    | 'layer-hint';
  /**
   * For `source`: the source is the basemap's own (its PMTiles file failed),
   * not one the document declared.
   */
  basemap?: boolean;
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
  /**
   * Extents the host already read, `[west, south, east, north]` by source id
   * (ml-aot.120): `<ml-map>` reads a `fitTo` COG's header before it builds
   * the map, so the map is built framed on the file instead of jumping
   * there once the COG reader reports it.
   */
  prefetchedExtents?: Record<string, [number, number, number, number]>;
  /**
   * Who owns the camera across updates (live documents, KTD13). `document`
   * (the default): a changed `center`, `zoom`, `bearing` or `pitch` eases
   * the map there and an added or re-targeted `fitTo` frames its source
   * once. `host`: the engine never moves the camera; the host re-applies
   * the document camera itself on `update:applied` when it wants it.
   */
  camera?: 'document' | 'host';
  /**
   * Detach and re-attach `@maplibre-yaml/effects` (live documents, KTD6b):
   * called by an update that adds or removes an `effect:` block, or rebuilds
   * or moves an effect-bearing layer, so the `::fx-` layers follow. `<ml-map>`
   * supplies it; a host rendering effects itself does the same.
   */
  onReattachEffects?: () => void;
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
  /** An update applied in place (live documents): what it did, by id. */
  'update:applied': { summary: UpdateSummary };
  /** An update was refused: the running map and document are unchanged. */
  'update:rejected': { kind: RejectionKind; errors: NonNullable<UpdateResult['errors']> };
}

/**
 * Main class for rendering maps from configuration
 */
/** The document's option blocks, as `denormalizeOptions` names them. */
const DOCUMENT_OPTION_KEYS = [
  'title', 'description', 'controls', 'legend', 'state', 'parameters', 'markers',
  'popups', 'images', 'terrain', 'sky', 'projection', 'light',
] as const satisfies readonly (keyof DocumentOptions)[];

/**
 * The document's option blocks out of the renderer options: the host's own
 * (`onError`, `chrome`, `sourceData`, ...) stay out, and an absent block
 * stays absent rather than becoming an `undefined` key.
 */
function documentOptions(options: MapRendererOptions): DocumentOptions {
  const picked: DocumentOptions = {};
  for (const key of DOCUMENT_OPTION_KEYS) {
    if (options[key] !== undefined) (picked as Record<string, unknown>)[key] = options[key];
  }
  return picked;
}

/** The renderer options with the document's blocks replaced by `next`'s: the host's own keep their values. */
function withDocumentOptions(options: MapRendererOptions, next: DocumentOptions): MapRendererOptions {
  const merged: Record<string, unknown> = { ...options };
  for (const key of DOCUMENT_OPTION_KEYS) delete merged[key];
  return { ...merged, ...next } as MapRendererOptions;
}

/** `config:` keys an update applies in place: the camera (KTD13), `fitTo`, and the options with a setter (KTD7). */
const IN_PLACE_CONFIG_KEYS: ReadonlySet<string> = new Set(['center', 'zoom', 'bearing', 'pitch', 'fitTo', 'minZoom', 'maxZoom', 'maxBounds']);

/**
 * Whether `next` forces a rebuild (KTD7), decided in the entry before the
 * engine chunk is awaited: a changed `mapStyle`, or any Map constructor
 * option without a setter. Mirrors `fallbackReason` in update/diff.ts,
 * which the chunk runs (and names the key).
 */
function needsRebuild(applied: MapConfig, next: MapConfig): boolean {
  const a = applied as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  return Object.keys({ ...a, ...b }).some(
    (key) => !IN_PLACE_CONFIG_KEYS.has(key) && JSON.stringify(a[key]) !== JSON.stringify(b[key])
  );
}

const NO_HINTS: DiffHints = { failedSources: new Set(), urlsRebased: false };

/** One queued update (KTD5): the next document, its hints, and the caller waiting on it. */
interface PendingUpdate {
  next: AppliedDocument;
  hints: DiffHints;
  resolve: (result: UpdateResult) => void;
}

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
  /** Sources whose view is too dense to read, and the line asking to zoom in. */
  private readonly denseSources = new Set<string>();
  private zoomInLine: HTMLElement | null = null;
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
   * The normalized document this map shows (KTD1, live documents): the four
   * constructor arguments, kept so `update(next)` can diff against them
   * without reading map state. Host-supplied options are not part of it.
   * Not public: `getDocument()` is its reader, and the update engine the
   * only writer.
   */
  protected applied: AppliedDocument;
  /** The options this map was built with; the document's blocks follow `applied` across updates. */
  private options: MapRendererOptions;
  /** `fitTo`: the camera's source, as the constructor or the last update resolved it. */
  private fitTarget: { fitTo: FitToConfig; fit: FitResolution } | null = null;
  /** The params panel's mount and builder, kept so an update rebuilds into the same corner slot. */
  private paramsMount: HTMLElement | null = null;
  private paramsBuilder: ParamsBuilder | null = null;
  /** The `description:` element the canvas points at, replaced by an update. */
  private descriptionEl: HTMLElement | null = null;
  /** The update in flight and the one waiting behind it (KTD5: one in flight, at most one queued). */
  private updateInFlight: Promise<UpdateResult> | null = null;
  private queuedUpdate: PendingUpdate | null = null;
  /** Bumped per started update; stale continuations compare against it. */
  private updateGeneration = 0;


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
    this.applied = { config, layers, sources: sources ?? {}, options: documentOptions(options) };
    this.options = options;

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
    // A Protomaps basemap from a `.pmtiles` file (ml-cnv.7): its style is
    // generated in the page, on demand, so the map is built without one and
    // given it when ready (below). `load` waits for it as for any style.
    const protomaps: ProtomapsBasemap | undefined = protomapsBasemapOf(mapStyle);
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
    let fit = fitTo ? resolveFitTo(fitTo, sources) : null;
    // A COG whose header the host already read (ml-aot.120): framed now.
    const extent = fitTo && fit?.kind === 'tile-bounds' ? options.prefetchedExtents?.[fitTo.source] : undefined;
    if (extent) fit = { kind: 'bounds', bounds: [[extent[0], extent[1]], [extent[2], extent[3]]] as Bounds };
    if (fitTo && fit) this.fitTarget = { fitTo, fit };
    const initialFit =
      fit && fit.kind === 'bounds'
        ? {
            bounds: fit.bounds,
            fitBoundsOptions: {
              // The author's padding, else a margin for the map's size (ml-aot.124).
              padding: fitToPadding(fitTo!, {
                width: this.containerEl?.clientWidth ?? 0,
                height: this.containerEl?.clientHeight ?? 0,
              }),
              ...(fitTo!.maxZoom !== undefined ? { maxZoom: fitTo!.maxZoom } : {}),
            },
          }
        : {};
    if (fit && fit.kind === 'unsupported') console.warn(`[maplibre-yaml] ${fit.reason}`);

    // Cloud-native formats (ml-cnv): register the protocols this document's
    // sources need (PMTiles, COG) on the module the map is built from, and
    // start downloading their readers. Started before the map exists and
    // never waited for: each protocol handler waits for its own reader, so
    // no other source waits for a reader it doesn't use.
    const protocolsPrepared = prepareProtocols(sources, layers, mapStyle);

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
    // A basemap style loaded from a URL: its relative URLs (a self-hosted
    // `pmtiles://nyc.pmtiles`, sprite, glyphs) resolve against the style
    // itself (renderer/basemap-urls), and a `pmtiles://` source it asks for
    // while the protocol is unusable (maplibre-gl 3) is reported once.
    const hostTransform = (mapConfig as { transformRequest?: unknown }).transformRequest;
    let pmtilesReported = false;
    const transformRequest =
      typeof mapStyle === 'string'
        ? basemapRequestTransformer(
            mapStyle,
            typeof hostTransform === 'function' ? (hostTransform as RequestTransformer) : undefined,
            () => {
              const problem = pmtilesUnavailable();
              if (!problem || pmtilesReported) return;
              pmtilesReported = true;
              console.warn(`[maplibre-yaml] the basemap style uses PMTiles: ${problem.message}`);
              options.onError?.(problem, false, { kind: 'source', sourceId: 'basemap' });
            }
          )
        : undefined;

    this.map = new MapLibreMap({
      ...mapConfig,
      ...(transformRequest ? { transformRequest } : {}),
      ...(locale !== undefined ? { locale } : {}),
      ...initialFit,
      ...(Object.keys(contextAttributes).length > 0
        ? { canvasContextAttributes: contextAttributes }
        : {}),
      container: typeof container === 'string' ? container : container,
      style: (protomaps ? undefined : mapStyle) as any,
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
    this.descriptionEl = applyAccessibleName(this.map, {
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

    // COG sources (ml-cnv.2): once a source's metadata has loaded, its reader
    // knows the file's extent (fitTo) and whether it is cloud-optimized (an
    // author hint when not).
    this.watchSourceData(new Set(sourceIdsReading('cog', sources, layers)));

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
        this.fitDeferred();
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
        console.warn(`[maplibre-yaml] ${consoleText(error.message)}`);
        options.onError?.(error, false, { kind: 'source', sourceId });
      },
      // A `before:` naming no layer: the layer was added on top (ml-aot.119).
      onLayerHint: (layerId, message) => {
        console.warn(`[maplibre-yaml] ${consoleText(message)}`);
        options.onError?.(new Error(message), false, { kind: 'layer-hint', layerId });
      },
      // A live `merge` whose features have no key (ml-aot.141): they are
      // kept, not matched; the console always, the page while developing.
      onSourceHint: (sourceId, message) => {
        console.warn(`[maplibre-yaml] ${consoleText(message)}`);
        options.onError?.(new Error(message), false, { kind: 'source-hint', sourceId });
      },
      onViewTooDense: (sourceId, dense) => this.showZoomIn(sourceId, dense),
    };

    const eventCallbacks: EventHandlerCallbacks = {
      onClick: (layerId, feature, lngLat) => this.emit('layer:click', { layerId, feature, lngLat }),
      onHover: (layerId, feature, lngLat) => this.emit('layer:hover', { layerId, feature, lngLat }),
      // A highlight with no feature ids (ml-37r.15): an author hint, like a
      // `before:` that names no layer.
      onHint: layerCallbacks.onLayerHint!,
    };

    // GeoParquet reads only the columns the document references (ml-cnv.4):
    // decided here, where every layer that draws from a source is known.
    const parquetColumns = geoParquetColumns(sources, layers);
    this.layerManager = new LayerManager(this.map, layerCallbacks, {
      ...options.sourceData,
      isProtocolRegistered,
      columnsFor: (sourceId) => parquetColumns.get(sourceId),
      // Named sources are added before any layer: say up front which ones a
      // highlighted layer draws from, so they get feature ids (ml-aot.142).
      namedSourcesNeedingIds: namedSourcesNeedingIds(layers),
    });
    const classifyRuntime = this.createClassify(layers, sources);
    if (classifyRuntime.active) this.classify = classifyRuntime;
    this.eventHandler = new EventHandler(this.map, eventCallbacks, options.capabilities);
    this.legendBuilder = new LegendBuilder({ strings: this.strings });
    this.controlsManager = new ControlsManager(this.map, {
      ...(options.terrain ? { terrain: options.terrain } : {}),
      beforeAttribution: () => this.attributionGuard.scrub(),
    });

    // Set up load handler. A cloud-native reader that can't be used (set up
    // or downloaded, ml-7qa.5) is reported on the sources that read it, with
    // a notice; everything else renders — without waiting for any reader.
    this.map.on('load', () => {
      if (protocolsPrepared) {
        const report = (failed: Map<CloudFormat, Error>) => {
          if (this.destroyed) return;
          for (const [format, error] of failed) {
            for (const sourceId of sourceIdsReading(format, sources, layers)) {
              options.onError?.(error, false, { kind: 'source', sourceId });
            }
          }
        };
        report(protocolsPrepared.failed);
        void protocolsPrepared.readers.then(report);
      }
      onStyleLoaded();
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
      const setState = this.stateSetter();
      this.applyStateDefaults(options.state);

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
      this.syncMarkers(options.markers);
      // Standalone popups (U14): open at their coordinates, same trust gate.
      this.syncPopups(options.popups);

      // An inline-data fit was applied by the constructor; announce it now
      // that listeners (attached after construction) can hear it.
      if (this.mapReadyFit) {
        this.fitApplied = true;
        // Built framed before the controls had their credits: if they turn
        // out taller than the margin kept for them (a long attribution on a
        // phone, a scale bar), frame again with the measured room.
        if (fitTo && fitTo.padding === undefined) {
          const container = this.map.getContainer?.();
          const measured = bottomControlsReserve(container);
          const assumed =
            (container?.clientWidth ?? 0) < NARROW_MAP_WIDTH ? ATTRIBUTION_RESERVE_NARROW : ATTRIBUTION_RESERVE_WIDE;
          if (measured !== undefined && measured > assumed) {
            this.map.fitBounds(this.mapReadyFit.bounds as never, this.fitOptions(fitTo));
          }
        }
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
      // A basemap style's own PMTiles file that failed (a self-hosted
      // basemap with a wrong path, a server without range requests): the
      // reader's plain-language failure, worth the map's notice rather than
      // blank tiles. Other basemap tile errors stay off the page.
      if (typeof e.sourceId === 'string' && BASEMAP_FILE_FAILURE.test(message)) {
        return { kind: 'source', sourceId: e.sourceId, basemap: true };
      }
      return undefined;
    };

    // Handle errors. Runtime maplibre error events are non-fatal — the map
    // still reaches `load` after a failed tile/sprite/glyph request — except
    // a basemap style that never loaded (classified above).
    // maplibre-gl v6 types `e.error` as `{ message }` (ErrorLike), not
    // Error; normalise so onError's contract holds on every major.
    // MapLibre fires `load` from a render frame in which every source has
    // settled, and a source whose TileJSON request failed settles without
    // asking for another frame. When the failure comes late — a basemap's
    // `pmtiles://` source waiting on a reader file that then didn't download
    // — no frame follows, `load` never fires and `mapReady()` would wait
    // forever. One more frame after a pre-load error lets MapLibre see it.
    let mapLoadFired = false;
    this.map.on('load', () => {
      mapLoadFired = true;
    });
    this.map.on('error', (e) => {
      if (!mapLoadFired && !this.destroyed) this.map.triggerRepaint?.();
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
      // A Protomaps basemap on a file that lacks some of its tile layers:
      // MapLibre reports each basemap layer naming one (dozens). Those are
      // the basemap's internals, not the document's; the file check
      // (loadProtomapsBasemap) says what is wrong, once.
      if (protomaps && MISSING_PROTOMAPS_LAYER.test(error.message)) return;
      const hinted = withWorkerUrlHint(error.message, runtimeVersion());
      if (hinted !== error.message) error = Object.assign(new Error(hinted), { cause: raw });
      const context = classify(e as never, error.message);
      // A basemap style that never loads is fatal: without it no layer can
      // draw and `load` never fires.
      options.onError?.(error, context?.kind === 'style', context);
      if (context?.basemap && context.sourceId && !mapLoadFired) {
        const sourceId = context.sourceId;
        setTimeout(() => this.dropDeadBasemapSource(sourceId), 0);
      }
    });

    if (protomaps) this.loadProtomapsBasemap(protomaps, options);
  }

  /**
   * Leave a Protomaps basemap's label layers out (maplibre-gl 4 with its
   * fonts unreachable: every basemap tile fails to parse, so nothing of the
   * basemap draws). The style is set again in full — the tiles that failed
   * are only requested again by a fresh load — keeping every other layer.
   *
   * @returns Whether labels were removed.
   */
  private hideBasemapLabels(): boolean {
    try {
      const style = this.map.getStyle() as { layers?: Array<Record<string, unknown>> };
      const layers = style.layers ?? [];
      const kept = layers.filter(
        (layer) =>
          !(
            layer['type'] === 'symbol' &&
            layer['source'] === PROTOMAPS_SOURCE_ID &&
            (layer['layout'] as Record<string, unknown> | undefined)?.['text-field'] !== undefined
          )
      );
      if (kept.length === layers.length) return false;
      this.map.setStyle({ ...style, layers: kept } as never, { diff: false });
      return true;
    } catch (error) {
      console.warn('[maplibre-yaml] the basemap labels could not be left out:', error);
      return false;
    }
  }

  /** `fitTo`'s padding for the map as it is now: the author's, else the default for its size. */
  private fitPadding(fitTo: FitToConfig): number | FitPadding {
    const canvas = this.map?.getContainer?.();
    return fitToPadding(fitTo, {
      width: canvas?.clientWidth ?? 0,
      height: canvas?.clientHeight ?? 0,
      bottomReserve: bottomControlsReserve(canvas),
    });
  }

  /**
   * A basemap source whose file couldn't be read before the map loaded,
   * on a maplibre-gl that counts it as still loading (4.x: a source whose
   * TileJSON request failed never reports itself loaded, so MapLibre never
   * fires `load` and `mapReady()` would wait forever). Its layers can draw
   * nothing; they and the source are removed so the map loads. The notice
   * already said why. Later releases count the failed source as settled and
   * keep it.
   */
  private dropDeadBasemapSource(sourceId: string): void {
    if (this.destroyed || !this.map) return;
    const source = this.map.getSource(sourceId) as { loaded?: () => boolean } | undefined;
    if (!source || typeof source.loaded !== 'function' || source.loaded()) return;
    try {
      for (const layer of this.map.getStyle()?.layers ?? []) {
        if ((layer as { source?: unknown }).source === sourceId) this.map.removeLayer(layer.id);
      }
      this.map.removeSource(sourceId);
      this.map.triggerRepaint?.();
    } catch (error) {
      console.warn(`[maplibre-yaml] the basemap source "${sourceId}" could not be removed:`, error);
    }
  }

  /**
   * Generate a Protomaps basemap's style (`mapStyle: { pmtiles: … }`) and
   * give it to the map, which was built without a style. Relative URLs
   * resolve against the page (`base` was applied to the document already);
   * labels default to the page's language at the map. A generator that
   * fails to download leaves a plain background under the document's
   * layers, with the map's notice; so does a file that is not a Protomaps
   * basemap (the notice only).
   */
  private loadProtomapsBasemap(spec: ProtomapsBasemap, options: MapRendererOptions): void {
    const map = this.map;
    // Usually started at parse time already (ml-map); harmless if so.
    prefetchProtomapsBasemap(spec);
    const pageUrl = typeof document !== 'undefined' ? document.baseURI : undefined;
    let pageLanguage: string | undefined;
    try {
      pageLanguage = elementLanguage(map.getContainer());
    } catch {
      pageLanguage = undefined;
    }
    let checked = false;
    map.on('sourcedata', (e: { sourceId?: unknown; sourceDataType?: unknown }) => {
      if (checked || e.sourceId !== PROTOMAPS_SOURCE_ID || e.sourceDataType !== 'metadata') return;
      checked = true;
      const source = map.getSource(PROTOMAPS_SOURCE_ID) as
        | { vectorLayerIds?: string[]; url?: string; loaded?: () => boolean }
        | undefined;
      // A source whose file didn't load (maplibre-gl 4 announces metadata
      // for it too) has nothing to judge: its own notice says why.
      if (!source?.url) {
        checked = false;
        return;
      }
      const problem = notAProtomapsBasemap(source.vectorLayerIds, source.url);
      if (!problem) {
        // A Protomaps file from the older tile schema draws only land and
        // water, silently (ml-aot.126): its metadata says which it is.
        const url = source.url;
        void archiveMetadata(url).then((metadata) => {
          const older = olderProtomapsSchema(metadata, url);
          if (!older || this.destroyed) return;
          console.warn(`[maplibre-yaml] ${consoleText(older)}`);
          options.onError?.(new Error(older), false, { kind: 'basemap' });
        });
        return;
      }
      console.warn(`[maplibre-yaml] ${consoleText(problem)}`);
      options.onError?.(new Error(problem), false, { kind: 'basemap' });
    });
    // A basemap icon its sprite lacks (the generator names "townhall", which
    // Protomaps' hosted sprite doesn't have): a blank image instead of a
    // MapLibre console warning on every load. The document's own image
    // names keep their warning (the styleimagemissing handler above).
    map.on('styleimagemissing', (e: { id: string }) => {
      if (this.imageRefs.names.has(e.id) || this.imageRefs.dynamic || map.hasImage(e.id)) return;
      map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    // Right-to-left labels on a maplibre-gl older than 6.9 need MapLibre's
    // plugin (renderer/basemap-assets).
    const language = basemapLanguage(spec, pageLanguage);
    ensureRightToLeftLabels(language, (pluginUrl) => {
      if (this.destroyed) return;
      const problem =
        `The basemap's ${language} labels need MapLibre's right-to-left text plugin, which couldn't ` +
        `be downloaded from ${new URL(pluginUrl).host}, so they may draw unjoined or reversed. ` +
        'maplibre-gl 6.9 or later draws them without it.';
      console.warn(`[maplibre-yaml] ${problem}`);
      options.onError?.(new Error(problem), false, { kind: 'basemap' });
    });
    protomapsStyle(spec, {
      ...(pageUrl ? { pageUrl } : {}),
      ...(pageLanguage ? { pageLanguage } : {}),
    }).then(
      (style) => {
        if (this.destroyed) return;
        map.setStyle(style as never);
        // Fonts or icons that don't load (Protomaps' host unreachable, a
        // self-hosted path that 404s): one notice, naming the host and the fix.
        const assets: BasemapAssets = {
          glyphs: String(style['glyphs'] ?? ''),
          sprite: String(style['sprite'] ?? ''),
          hostedGlyphs: typeof spec.glyphs !== 'string',
          hostedSprite: typeof spec.sprite !== 'string',
        };
        // Checked once: on the first error that may be about them (a style
        // error; on maplibre-gl 4 a basemap tile error, which is how missing
        // fonts show there), else after the map first goes idle — MapLibre
        // reports a font that didn't load only on the console (5 and later).
        let assetsChecked = false;
        const checkAssets = () => {
          if (assetsChecked || this.destroyed) return;
          assetsChecked = true;
          void probeBasemapAssets(assets).then((failed) => {
            if (this.destroyed || failed.length === 0) return;
            // maplibre-gl 4 parses no basemap tile whose labels lack their
            // fonts: leave the labels out so the rest of the basemap draws.
            const major = Number(runtimeVersion()?.split('.')[0]);
            const labelsHidden = failed.includes('glyphs') && major > 0 && major < 5 && this.hideBasemapLabels();
            const problem = basemapAssetMessage(failed, assets, { labelsHidden });
            console.warn(`[maplibre-yaml] ${consoleText(problem)}`);
            options.onError?.(new Error(problem), false, { kind: 'basemap' });
          });
        };
        map.on('error', (event) => {
          const e = event as unknown as { sourceId?: unknown; tile?: unknown; layer?: unknown };
          if (e.layer !== undefined) return;
          if (e.sourceId === undefined && e.tile === undefined) checkAssets();
          else if (e.sourceId === PROTOMAPS_SOURCE_ID) checkAssets();
        });
        map.on('idle', checkAssets); // checkAssets runs once
        // maplibre-gl 3 cannot read pmtiles:// (cloud-protocols).
        const problem = pmtilesUnavailable();
        if (problem) {
          console.warn(`[maplibre-yaml] the basemap uses PMTiles: ${problem.message}`);
          options.onError?.(problem, false, { kind: 'source', sourceId: PROTOMAPS_SOURCE_ID, basemap: true });
        }
      },
      (error: unknown) => {
        // The generator didn't download (offline, a blocker, a self-hosted
        // copy without dist/chunks/): no basemap, but the document's own
        // layers still draw on a plain background, and the notice says why.
        if (this.destroyed) return;
        const cause = error instanceof Error ? error : new Error(String(error));
        map.setStyle(fallbackBasemapStyle(spec, pageUrl) as never);
        console.warn(`[maplibre-yaml] the basemap could not be built: ${consoleText(cause.message)}`);
        options.onError?.(cause, false, { kind: 'basemap' });
      }
    );
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
    const prepared = this.prepareLayer(layer);
    if (!prepared) return;
    await this.layerManager.addLayer(prepared);
    this.eventHandler.attachEvents(prepared);
    this.emit('layer:added', { layerId: prepared.id });
  }

  /**
   * The per-layer prelude every add shares — first render, `addLayer`, and
   * an update's adds and replacements (`UpdateHost.prepareLayer`): the
   * version gate, image references, protocol registration and the basemap
   * text font. Returns the layer to add; `undefined` when it is skipped
   * with its own warning; throws when its protocol can't be used.
   */
  private prepareLayer(layer: Layer): Layer | undefined {
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
      return undefined;
    }
    noteLayerImageRefs(this.imageRefs, layer);
    // A layer added after load may bring its own PMTiles source (ml-cnv).
    const prepared = prepareProtocols(undefined, [layer]);
    const [unusable] = prepared?.failed.values() ?? [];
    if (unusable) throw unusable;
    return this.withBasemapTextFont(layer);
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
    options: Pick<MapRendererOptions, 'parameters' | 'state'>,
    setState: ((name: string, value: unknown) => void) | undefined
  ): void {
    if (this.paramsBuilt) return;
    const toggleableLayers = layers.flatMap((layer) => {
      const l = layer as unknown as Record<string, unknown>;
      if (typeof l['label'] !== 'string' || l['toggleable'] === false) return [];
      // Hidden is hidden however it was spelled: `visible: false` or the
      // spec-native `layout: { visibility: "none" }` passthrough. (A panel
      // rebuilt by an update seeds from the document; U5's visibility
      // overrides with provenance keep a reader's toggle across it, KTD6.)
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
    // A rebuild with nothing left to show empties the slot it had.
    this.paramsMount?.replaceChildren();
    if (!hasPanelContent(panelConfig)) return;

    this.paramsBuilt = true;
    const mount = (this.paramsMount ??= this.mountParams());
    (this.paramsBuilder ??= new ParamsBuilder({
      strings: this.strings,
      language: mapLanguage(this.map),
    })).build(mount, panelConfig, {
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

  /** The params panel's slot in the corner system, created once. */
  private mountParams(): HTMLElement {
    const mount = document.createElement('div');
    this.chromeLayout().mount('top-right', mount);
    return mount;
  }

  /** MapLibre's `setGlobalStateProperty`, when the runtime has one (>= 5.6). */
  private stateSetter(): ((name: string, value: unknown) => void) | undefined {
    return (this.map as unknown as { setGlobalStateProperty?: (name: string, value: unknown) => void })
      .setGlobalStateProperty;
  }

  /**
   * Apply the document's `state:` defaults (`{ key: { default } }`) through
   * `setGlobalStateProperty`, all of them or only `keys`. On a runtime
   * without it a declared block warns once instead of silently doing
   * nothing (the declared-absence posture, R5/U8).
   */
  private applyStateDefaults(state: Record<string, unknown> | undefined, keys?: readonly string[]): void {
    if (!state || Object.keys(state).length === 0) return;
    const setState = this.stateSetter();
    if (typeof setState !== 'function') {
      console.warn(
        '[maplibre-yaml] this document declares `state:`, but the running ' +
          'maplibre-gl has no setGlobalStateProperty (needs >= 5.6); ' +
          '`global-state` expressions will read null.',
      );
      return;
    }
    for (const [key, entry] of Object.entries(state)) {
      if (keys && !keys.includes(key)) continue;
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
  }

  /** The classify runtime over `layers` and `sources`, wired to the legend, the event bus and the error path. */
  private createClassify(layers: Layer[], sources: Record<string, LayerSource> | undefined): ClassifyRuntime {
    return new ClassifyRuntime(
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
          console.warn(`[maplibre-yaml] ${consoleText(error.message)}`);
          this.options.onError?.(error, false, { kind: 'classify', layerId, sourceId });
        },
        // An author hint: the console always, the page while developing.
        onFieldProblem: (layerId, message) => {
          console.warn(`[maplibre-yaml] ${consoleText(message)}`);
          this.options.onError?.(new Error(message), false, { kind: 'classify-field', layerId });
        },
      }
    );
  }

  /** Standalone `markers:`: the current ones go, the block's are added (none for an absent block). */
  private syncMarkers(markers: MarkerConfig[] | undefined): void {
    this.markersManager?.destroy();
    this.markersManager = null;
    if (!markers || markers.length === 0) return;
    this.markersManager = new MarkersManager(this.map, this.options.capabilities, {
      onMarkersAdded: (count) => this.emit('markers:added', { count }),
      onMarkerClick: (index, at) => this.emit('marker:click', { index, at }),
      onMarkerIconError: (index, icon) => this.emit('marker:icon-error', { index, icon }),
    });
    this.markersManager.add(markers);
  }

  /** Standalone `popups:`: the open ones close, the block's open (none for an absent block). */
  private syncPopups(popups: StandalonePopupConfig[] | undefined): void {
    this.popupsManager?.destroy();
    this.popupsManager = null;
    if (!popups || popups.length === 0) return;
    this.popupsManager = new PopupsManager(this.map, this.options.capabilities);
    this.popupsManager.add(popups);
  }

  /**
   * The legend over the next document's layers (live documents): redrawn in
   * place when it exists (the reader's open/closed choice kept), created
   * when the document gains one, removed when it loses it or the host's
   * `legend` slot stands in for it.
   */
  private syncLegend(layers: Layer[], legendOption: LegendConfig | false | undefined): void {
    if (this.options.legendElement) return;
    const legend = effectiveLegend(legendOption, layers, AUTO_LEGEND);
    const target = this.legendTarget;
    if (legend && target && this.autoLegendContainer && target.config?.position === legend.position) {
      this.legendTarget = { container: target.container, layers, config: legend };
      this.redrawLegend();
      return;
    }
    this.autoLegendContainer?.remove();
    this.autoLegendContainer = null;
    this.legendTarget = null;
    this.legendBuilt = false;
    if (legend) this.buildLegend(this.createLegendContainer(legend), layers, legend);
  }

  /** The params panel rebuilt into its slot from the next document, seeded from current values. */
  private syncParamsPanel(layers: Layer[], options: DocumentOptions): void {
    this.paramsBuilt = false;
    this.buildParamsPanel(layers, options, this.stateSetter());
  }

  /** The classify runtime re-seeded from the next document, created when the document gains its first classified layer. */
  private syncClassify(layers: Layer[], sources: Record<string, LayerSource>, layerIds: readonly string[]): void {
    if (!this.classify) {
      const runtime = this.createClassify(layers, sources);
      if (!runtime.active) return;
      this.classify = runtime;
    } else {
      this.classify.reseed(layers as never, sources, layerIds);
    }
    void this.classify.layersReady();
  }

  /** Rename and re-describe the map: MapLibre's own `Map.Title` and the canvas's `aria-*`. */
  private setTitle(title: string | undefined, description: string | undefined): void {
    const generic = this.strings('Map.Title');
    const named = title?.trim() ? title : undefined;
    const locale = (this.map as unknown as { _locale?: Record<string, unknown> })._locale;
    if (locale && typeof locale === 'object') locale['Map.Title'] = named ?? generic;
    const canvas = this.map.getCanvas?.();
    const described = this.descriptionEl;
    if (described && canvas) {
      const ids = (canvas.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((id) => id && id !== described.id);
      if (ids.length > 0) canvas.setAttribute('aria-describedby', ids.join(' '));
      else canvas.removeAttribute('aria-describedby');
    }
    described?.remove();
    if (!named) canvas?.setAttribute('aria-label', generic);
    this.descriptionEl = applyAccessibleName(this.map, {
      ...(named !== undefined ? { title: named } : {}),
      ...(description !== undefined ? { description } : {}),
      strings: this.strings,
    });
  }

  /** One 3D, projection or light block applied in place, or cleared when the document dropped it. */
  private applyScene(option: 'projection' | 'sky' | 'terrain' | 'light', value: unknown): void {
    const map3d = this.map as unknown as Scene3DMap;
    switch (option) {
      case 'projection':
        applyProjection(map3d, (value ?? { type: 'mercator' }) as ProjectionConfig);
        return;
      case 'sky':
        if (value) applySky(map3d, value as SkyConfig);
        else map3d.setSky?.call(map3d, undefined as never);
        return;
      case 'terrain':
        if (value) applyTerrain(map3d, value as TerrainConfig, true);
        else map3d.setTerrain?.call(map3d, null);
        return;
      case 'light':
        // A rejected light (setLight validates) is the update's failure to record, not a warning.
        this.map.setLight((value ?? {}) as never);
        return;
    }
  }

  /**
   * A `fitTo` added or re-targeted by an update (KTD13): frame its source
   * once, now when its extent is known (inline data, a loader's extent,
   * fetched data already in), else when its data or metadata lands, as
   * first render does. A typo names no source: the authored camera stands.
   */
  private fitToSource(fitTo: FitToConfig, sources: Record<string, LayerSource>): void {
    const fit = resolveFitTo(fitTo, sources);
    this.fitTarget = { fitTo, fit };
    this.fitApplied = false;
    if (fit.kind === 'unsupported') throw new Error(fit.reason);
    if (fit.kind === 'bounds') {
      this.fitApplied = true;
      this.map.fitBounds(fit.bounds as never, this.fitOptions(fitTo));
      this.emit('camera:fit', { source: fitTo.source, bounds: fit.bounds });
    } else if (fit.kind === 'tile-bounds') {
      const source = this.map.getSource(fitTo.source) as { bounds?: unknown } | undefined;
      if (source) this.fitTileBounds(fitTo.source, source);
    } else {
      this.fitDeferred();
    }
  }

  /** `fitBounds` options for a `fitTo`: its padding, its `maxZoom`, no animation. */
  private fitOptions(fitTo: FitToConfig): { padding: number | FitPadding; maxZoom?: number; animate: false } {
    return {
      padding: this.fitPadding(fitTo),
      ...(fitTo.maxZoom !== undefined ? { maxZoom: fitTo.maxZoom } : {}),
      animate: false,
    };
  }

  /**
   * Once a source's metadata has loaded: a `fitTo` on a tiled source with an
   * extent (a COG) frames it, and a COG that isn't cloud-optimized is hinted.
   * Attached once per map (an update's `fitTo` may name a COG later).
   */
  private watchSourceData(cogSources: Set<string>): void {
    const hinted = new Set<string>();
    this.map.on('sourcedata', (e: { sourceId?: string; sourceDataType?: string }) => {
      if (this.destroyed || e.sourceDataType !== 'metadata' || !e.sourceId) return;
      const source = this.map.getSource(e.sourceId) as { url?: unknown; bounds?: unknown } | undefined;
      if (!source) return;
      this.fitTileBounds(e.sourceId, source);
      if (cogSources.has(e.sourceId) && !hinted.has(e.sourceId) && typeof source.url === 'string') {
        const hint = cogHintFor(source.url);
        if (hint) {
          hinted.add(e.sourceId);
          this.options.onError?.(new Error(hint), false, { kind: 'source-hint', sourceId: e.sourceId });
        }
      }
    });
  }

  /** `fitTo` on a tiled source: frame the extent its reader reports, once. */
  private fitTileBounds(sourceId: string, source: { bounds?: unknown }): void {
    const target = this.fitTarget;
    if (!target || target.fit.kind !== 'tile-bounds' || sourceId !== target.fitTo.source || this.fitApplied) return;
    const { fitTo } = target;
    const b = source.bounds;
    if (Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === 'number')) {
      const bounds: Bounds = [[b[0], b[1]], [b[2], b[3]]] as Bounds;
      this.fitApplied = true;
      this.map.fitBounds(bounds, this.fitOptions(fitTo));
      this.emit('camera:fit', { source: fitTo.source, bounds });
    }
  }

  /**
   * `fitTo` over fetched data: frame the source once its data is in (the
   * loader's own extent for a source read by view). Whether it fit.
   */
  private fitDeferred(): boolean {
    const target = this.fitTarget;
    if (!target || target.fit.kind !== 'deferred' || this.fitApplied) return false;
    const { fitTo } = target;
    const data = this.layerManager.getSourceData(fitTo.source);
    // A source read by view (FlatGeobuf or GeoParquet `load: viewport`,
    // ml-cnv.3/.4) holds only the part in view: frame the file's own extent.
    const bounds =
      this.layerManager.getSourceExtent?.(fitTo.source) ??
      (data ? geojsonBounds(data) : null);
    if (!bounds) return false;
    this.fitApplied = true;
    const fitOptions = this.fitOptions(fitTo);
    // ...and never further out than it is read: a citywide file
    // framed at zoom 9.9 opened blank under a `minzoom` of 10, and at
    // zoom 10 its view held 855,773 features — over the 150,000 one
    // read takes — so it opened on the "zoom in" line. Centred on the
    // extent, at the outermost zoom whose view the reader's index or
    // row-group statistics say is read (or the source's minzoom when
    // none is near; the author's maxZoom still caps it).
    const minzoom = this.layerManager.getViewMinzoom?.(fitTo.source);
    const camera =
      minzoom !== undefined ? this.map.cameraForBounds?.(bounds, fitOptions) : undefined;
    if (minzoom !== undefined && camera?.center && camera.zoom !== undefined) {
      const center = camera.center as { lng: number; lat: number };
      const container = this.map.getContainer?.();
      const fits = this.layerManager.getViewZoomThatFits?.(
        fitTo.source,
        [center.lng, center.lat],
        camera.zoom,
        container?.clientWidth ?? 0,
        container?.clientHeight ?? 0
      );
      let zoom = Math.max(camera.zoom, fits ?? minzoom);
      if (fitTo.maxZoom !== undefined) zoom = Math.min(zoom, Math.max(fitTo.maxZoom, minzoom, camera.zoom));
      if (zoom > camera.zoom) this.map.jumpTo({ center: camera.center, zoom });
      else this.map.fitBounds(bounds, fitOptions);
    } else {
      this.map.fitBounds(bounds, fitOptions);
    }
    this.emit('camera:fit', { source: fitTo.source, bounds });
    return true;
  }

  /**
   * The normalized document this map shows (KTD15): the shape the
   * constructor receives and `update()` takes, never the parsed `MapBlock`
   * (`<ml-map>.getDocument()` returns that). After `update:applied` it is
   * the next document, failures included: the document is the source of
   * truth (KTD7).
   */
  getDocument(): AppliedDocument {
    return this.applied;
  }

  /**
   * Apply a changed document to the running map in place (live documents,
   * 0.10): layers, sources, runtime features and the camera follow the
   * difference between the applied document and `next`; nothing else is
   * touched, and a host's own layers are never moved or removed (R10).
   *
   * @remarks
   * Resolves when the outcome is final (KTD5): `applied` after the last
   * operation and re-sync (with `update:applied` fired), `fallback` when
   * `next` needs a rebuild (`mapStyle`, a constructor-only option) — decided
   * before anything is awaited, and nothing is mutated: the host rebuilds —,
   * `rejected` with `kind: 'chunk'` when the engine's file couldn't be
   * downloaded (`update:rejected` fired, map and document unchanged), or
   * `superseded` when a later `update()` replaced this one in the queue.
   * One update applies at a time; an update arriving mid-apply waits, and
   * only the last waiting one runs, against the document applied by then.
   * An update made before the map's own `load` waits for it.
   *
   * @param next - The normalized document, as the constructor takes it.
   * @param hints - What the documents don't say (KTD11): sources whose last
   *   load failed and whether `base` re-resolved URLs. Default: none, so an
   *   unchanged document is a no-op.
   */
  update(next: AppliedDocument, hints: DiffHints = NO_HINTS): Promise<UpdateResult> {
    if (this.destroyed) return Promise.resolve({ outcome: 'superseded' });
    if (this.updateInFlight) {
      this.queuedUpdate?.resolve({ outcome: 'superseded' });
      return new Promise<UpdateResult>((resolve) => {
        this.queuedUpdate = { next, hints, resolve };
      });
    }
    return this.startUpdate(next, hints);
  }

  /** Run one update now, then the queued one if any (last wins, KTD5). */
  private startUpdate(next: AppliedDocument, hints: DiffHints): Promise<UpdateResult> {
    const generation = ++this.updateGeneration;
    const run = this.performUpdate(next, hints, generation).finally(() => {
      if (this.updateInFlight === run) this.updateInFlight = null;
      const queued = this.queuedUpdate;
      if (!queued) return;
      this.queuedUpdate = null;
      queued.resolve(this.startUpdate(queued.next, queued.hints) as never);
    });
    this.updateInFlight = run;
    return run;
  }

  private async performUpdate(next: AppliedDocument, hints: DiffHints, generation: number): Promise<UpdateResult> {
    // Fallback is decided here, synchronously, before any await (KTD7).
    if (needsRebuild(this.applied.config, next.config)) {
      return {
        outcome: 'fallback',
        summary: { added: [], removed: [], moved: [], replaced: [], propertiesSet: [], sourcesReplaced: [], cameraMoved: false, rebuild: true, failures: [] },
      };
    }
    const stale = () => this.destroyed || generation !== this.updateGeneration;
    // An update made before the document loads waits for the renderer's own `load`.
    if (!this.layersAdded) await new Promise<void>((resolve) => this.on('load', () => resolve()));
    if (stale()) return { outcome: 'superseded' };
    let engine: Awaited<ReturnType<typeof getDecoder<'update'>>>;
    try {
      engine = await getDecoder('update');
    } catch (error) {
      if (stale()) return { outcome: 'superseded' };
      // The seam rejects with the chunk wording (FormatError, code "chunk"); anything else is the same story to a host.
      const kind: RejectionKind = 'chunk';
      const errors = [{ kind, message: error instanceof Error ? error.message : String(error) }];
      this.emit('update:rejected', { kind, errors });
      return { outcome: 'rejected', errors };
    }
    if (stale()) return { outcome: 'superseded' };
    const result = await engine.runUpdate(this.updateHost(), { applied: this.applied, next, hints });
    if (stale()) return { outcome: 'superseded' };
    if (result.summary.rebuild) return { outcome: 'fallback', summary: result.summary };
    this.applied = next;
    this.options = withDocumentOptions(this.options, next.options);
    if (result.changed) this.emit('update:applied', { summary: result.summary });
    return { outcome: 'applied', summary: result.summary };
  }

  /** What the engine chunk reaches the renderer through (KTD10). */
  private updateHost(): UpdateHost {
    const runtime: RuntimeHost = {
      syncLegend: (layers, legend) => this.syncLegend(layers, legend),
      syncParamsPanel: (layers, options) => this.syncParamsPanel(layers, options),
      syncMarkers: (markers) => this.syncMarkers(markers),
      syncPopups: (popups) => this.syncPopups(popups),
      syncClassify: (layers, sources, layerIds) => this.syncClassify(layers, sources, layerIds),
      syncState: (state, keys) => this.applyStateDefaults(state, keys),
      setTitle: (title, description) => this.setTitle(title, description),
      loadImages: (images) =>
        loadDocumentImages(this.map, images, (name, url) => this.emit('image:error', { name, url })),
      applyScene: (option, value) => this.applyScene(option, value),
      fitTo: (fitTo, sources) => this.fitToSource(fitTo, sources),
    };
    return {
      map: this.map,
      layerManager: this.layerManager,
      eventHandler: this.eventHandler,
      legendBuilder: this.legendBuilder,
      paramsBuilder: this.paramsBuilder,
      controlsManager: this.controlsManager,
      classify: this.classify,
      strings: this.strings,
      camera: this.options.camera ?? 'document',
      runtime,
      onError: (error, context) => this.options.onError?.(error, false, context),
      reattachEffects: () => this.options.onReattachEffects?.(),
      prepareLayer: (layer) => this.prepareLayer(layer),
      emit: (event, payload) => this.emit(event, payload),
    };
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
   * The reader's "zoom in" line (ml-37r.17): shown over the map while any
   * source read by view draws nothing until the reader zooms in (below its
   * `minzoom`, or its view holds more features than one read takes), and
   * gone once every such source is read again — or loses its last layer.
   *
   * @remarks
   * Styled by a stylesheet, not inline (ml-cnv.32): `<ml-map quiet>` hides it
   * whenever the attribute is set, not only when the line was created, and
   * its colours follow the page's colour scheme (`Canvas` / `CanvasText`,
   * overridable with `--ml-map-zoom-in-background` / `--ml-map-zoom-in-color`).
   */
  private showZoomIn(sourceId: string, dense: boolean): void {
    const sources = this.denseSources;
    if (dense) sources.add(sourceId);
    else sources.delete(sourceId);
    if (!sources.size) {
      this.zoomInLine?.remove();
      this.zoomInLine = null;
    } else if (!this.zoomInLine) {
      const container = this.map.getContainer();
      ensureZoomInStyles(container.ownerDocument);
      const line = (this.zoomInLine = container.ownerDocument.createElement('div'));
      line.className = ZOOM_IN_CLASS;
      line.setAttribute('role', 'status');
      line.textContent = this.strings('maplibre-yaml.Notice.ZoomIn');
      container.append(line);
    }
  }

  /**
   * Destroy the map and clean up resources
   */
  destroy(): void {
    this.queuedUpdate?.resolve({ outcome: 'superseded' });
    this.queuedUpdate = null;
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
    this.zoomInLine?.remove();
    this.eventListeners.clear();
    this.attributionGuard.dispose();
    this.map.remove();
  }
}
