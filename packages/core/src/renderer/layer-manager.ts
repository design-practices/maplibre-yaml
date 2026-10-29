/**
 * @file Layer manager for MapLibre map layers
 * @module @maplibre-yaml/core/renderer
 */

import { suggest } from "../utils/suggest";
import { absolutizeSourceUrls, absolutizeTileTemplate, absolutizeVectorTiles } from "../utils/tile-url";
import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";
import type { z } from "zod";
import type { FeatureCollection } from "geojson";
import {
  LayerSchema,
  GeoJSONSourceSchema,
  VectorSourceSchema,
  RasterSourceSchema,
  RasterDEMSourceSchema,
  ImageSourceSchema,
  VideoSourceSchema,
} from "../schemas";
// maplibre-gl free (it imports the hover key from its submodule, not the
// interactions barrel, which eagerly loads maplibre-gl's `Popup`).
import {
  HIGHLIGHT_PAINT_PROPERTY,
  classifiedHighlightProperty,
  isHighlightEnabled,
  isHighlightWrapped,
  withHighlight,
} from "./highlight-paint";
import { DataFetcher } from "../data/data-fetcher";
import { loadSourceData } from "../data/source-data";
// Live data (polling, streaming, merging) is the `live` chunk (bundle
// headroom, U4): types only here, the code through `getDecoder("live")`.
import type { PollingManager } from "../data/polling-manager";
import type { StreamManager } from "../data/streaming/stream-manager";
import type { DataMerger, MergeStrategy } from "../data/merge/data-merger";
import { foreignChunk, getDecoder, prefetchDecoder, type Decoders } from "../formats/decoders";
import { sanitizeAttribution } from "../utils/attribution";
import { declaredColumns, formatOfSource, typeReadsFormat } from "../formats/detect";
// FlatGeobuf and GeoParquet are read by their reader chunks (bundle
// headroom, U5): the data providers come from `cloudReaders`, types only here.
import {
  abandonStarted,
  cloudReaders,
  loadedCloudReaders,
  loadModeOf,
  sizeLimits,
  startFlatGeobufOpen,
  startGeoParquetTail,
  toMapLibreTileSpec,
  withoutFormatKeys,
  type FlatGeobufCallbacks,
  type FormatLoader,
  type ReaderFormat,
} from "./cloud-sources";
import type { StartedOpen, StartedTail } from "./cloud-host";

type Layer = z.infer<typeof LayerSchema>;
type GeoJSONSourceConfig = z.infer<typeof GeoJSONSourceSchema>;
type VectorSourceConfig = z.infer<typeof VectorSourceSchema>;
type RasterSourceConfig = z.infer<typeof RasterSourceSchema>;
type RasterDEMSourceConfig = z.infer<typeof RasterDEMSourceSchema>;
type ImageSourceConfig = z.infer<typeof ImageSourceSchema>;
type VideoSourceConfig = z.infer<typeof VideoSourceSchema>;

const emptyCollection = (): FeatureCollection => ({ type: "FeatureCollection", features: [] });

/** The polling interval a GeoJSON source asks for (`refresh.refreshInterval`, or the legacy top-level key). */
function intervalOf(config: GeoJSONSourceConfig | undefined): number | undefined {
  return config?.refresh?.refreshInterval || config?.refreshInterval || undefined;
}

/** The merge strategy a source's live updates use. */
function strategyOf(config: GeoJSONSourceConfig | undefined): MergeStrategy {
  return config?.refresh?.updateStrategy || config?.updateStrategy || "replace";
}

/** What a live update merges with (strategy, key and window), from the refresh block or the legacy keys. */
function mergeOptionsOf(config: GeoJSONSourceConfig): {
  strategy: MergeStrategy;
  updateKey?: string;
  windowSize?: number;
  windowDuration?: number;
  timestampField?: string;
} {
  return {
    strategy: strategyOf(config),
    updateKey: config.refresh?.updateKey || config.updateKey,
    windowSize: config.refresh?.windowSize,
    windowDuration: config.refresh?.windowDuration,
    timestampField: config.refresh?.timestampField,
  };
}

/**
 * Everything a running poll captured besides its interval (the URL, the
 * cache policy, the merge options): a change here restarts the poll, an
 * interval change alone reschedules it (live documents, U3).
 */
function pollingShape(config: GeoJSONSourceConfig | undefined): string {
  if (!config) return "";
  const { refreshInterval: _interval, ...refresh } = (config.refresh ?? {}) as Record<string, unknown>;
  return JSON.stringify({ url: config.url, cache: config.cache, refresh, updateStrategy: config.updateStrategy, updateKey: config.updateKey });
}

/**
 * Whether a source starts a live pipeline once its first data is in: the
 * gates `addLayer` and `startSourcePipeline` apply (a `refresh` block, or
 * the legacy `refreshInterval`), then what `setupDataUpdates` starts (a
 * `stream`, or an interval with a `url`). Only then is the `live` chunk
 * fetched ahead; a legacy `updateStrategy` alone, or a `refresh` block with
 * no interval and no stream, starts nothing.
 */
function startsLive(config: GeoJSONSourceConfig | undefined): boolean {
  if (config?.type !== "geojson") return false;
  if (!config.refresh && !config.refreshInterval) return false;
  const format = formatOfSource(config);
  if (format === "flatgeobuf" || format === "geoparquet") return false;
  return Boolean(config.stream) || Boolean(intervalOf(config) && config.url);
}

/** The live-data chunk's module (data/live). */
type LiveModule = Decoders["live"];

/** The live-data managers one `LayerManager` runs, once the `live` chunk is in. */
interface LiveData {
  polling: PollingManager;
  streams: StreamManager;
  merger: DataMerger;
  mergeKeyOf: LiveModule["mergeKeyOf"];
}

/** Everything a stream connection captured; `undefined` when the source has no stream. */
function streamShape(config: GeoJSONSourceConfig | undefined): string | undefined {
  if (!config?.stream) return undefined;
  return JSON.stringify({ stream: config.stream, url: config.url, merge: mergeOptionsOf(config) });
}

/** What a FlatGeobuf or GeoParquet reader was built from: a change here recreates it. */
function loaderShape(config: GeoJSONSourceConfig): string {
  return JSON.stringify({
    url: config.url,
    format: formatOfSource(config),
    load: loadModeOf(config),
    columns: declaredColumns(config),
  });
}

/** Structural equality of two JSON-shaped values. */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Wrap the layer's primary colour in a feature-state `case`, so a highlighted
 * feature renders differently.
 *
 * @remarks
 * Rewrites a plain literal colour, and a colour `classify:` generated (the
 * library's own expression, re-wrapped by the classify runtime when computed
 * breaks land). An authored expression is left alone and warned about:
 * overwriting it would silently discard data-driven styling, and merging
 * arbitrary expressions is not something we can do correctly. The layer's
 * own `paint` object is not modified (a re-add must not wrap twice).
 */
function applyHighlightPaint(layerSpec: any, layer: Layer): void {
  const layerType = layer.type;
  const property = HIGHLIGHT_PAINT_PROPERTY[layerType];
  if (!property) {
    console.warn(
      `[maplibre-yaml] hover.highlight is not supported on "${layerType}" ` +
        "layers — they have no per-feature colour to drive."
    );
    return;
  }

  const paint = (layerSpec.paint = { ...(layerSpec.paint ?? {}) });
  const authored = paint[property];
  if (isHighlightWrapped(authored)) return;

  if (Array.isArray(authored)) {
    if (classifiedHighlightProperty(layer) === property) {
      paint[property] = withHighlight(authored);
      return;
    }
    console.warn(
      `[maplibre-yaml] hover.highlight left "${property}" on layer ` +
        `"${layerSpec.id}" untouched because it is already an expression. ` +
        'Reference ["feature-state", "hover"] in that expression to style the ' +
        "highlight yourself."
    );
    return;
  }

  // MapLibre's default for every colour paint property we highlight through.
  paint[property] = withHighlight(authored ?? "#000000");
}

/**
 * Put a GeoJSON source's id strategy on its MapLibre spec.
 *
 * @remarks
 * The author's `generateId` / `promoteId` always win, `generateId: false`
 * included. Otherwise, when a layer over the source uses feature-state
 * (`hover.highlight`), `generateId: true` is set: feature-state is addressed
 * by feature id, and without one the highlight is silently dead. That holds
 * for inline data and for data loaded from `url:` alike (ml-aot.142; the
 * `url:` path used to only warn).
 *
 * Generated ids are the feature's position in the data. That is stable across
 * a `merge` refresh — merge keeps every keyed feature in its place and appends
 * new ones — and after any refresh the renderer drops hover state anyway, so
 * `promoteId` on the merge key would buy nothing and would fail on features
 * that carry their key only as a top-level `id`. The cost: generated ids
 * replace ids the data had, so an author who filters on `["id"]` keeps their
 * own with `generateId: false` (numeric ids) or `promoteId`.
 */
function withFeatureIds(
  spec: Record<string, unknown>,
  config: { generateId?: boolean; promoteId?: unknown },
  needsIds: boolean
): void {
  if (config.generateId !== undefined) spec["generateId"] = config.generateId;
  if (config.promoteId !== undefined) spec["promoteId"] = config.promoteId;
  if (needsIds && config.generateId === undefined && config.promoteId === undefined) {
    spec["generateId"] = true;
  }
}

/** How {@link LayerManager.addLayer} treats a layer's inline `url:` read. */
export interface LayerAddOptions {
  /** Resolve once the data is in (default) — or once the layer is placed, the read going on alongside. */
  awaitData?: boolean;
}

/**
 * Callbacks for layer data loading events
 */
export interface LayerManagerCallbacks {
  onDataLoading?: (layerId: string) => void;
  onDataLoaded?: (layerId: string, featureCount: number) => void;
  onDataError?: (layerId: string, error: Error) => void;
  /**
   * A source that can't be read in this version (a reserved cloud-native
   * format, ml-cnv): reported once, with a plain-language error. The
   * source is added as an empty placeholder so its layers draw nothing
   * rather than fail one by one.
   */
  onSourceError?: (sourceId: string, error: Error) => void;
  /**
   * An author hint about one layer that was still added (a `before:` naming
   * no layer on the map: the layer goes on top instead of being dropped).
   */
  onLayerHint?: (layerId: string, message: string) => void;
  /**
   * An author hint about one source that still draws (a live `merge`
   * update whose features have no `updateKey`: they are kept, not matched).
   */
  onSourceHint?: (sourceId: string, message: string) => void;
  /**
   * A source read by view whose view holds more features than one read
   * takes (`true`: nothing was read, the reader should zoom in), or no longer
   * does (`false`) (ml-37r.17).
   */
  onViewTooDense?: (sourceId: string, dense: boolean) => void;
}

/**
 * Data loading a host already started for named sources (ml-aot.75).
 */
export interface LayerManagerDataOptions {
  /**
   * The fetcher (and its cache) to load with — the one the host's prefetch
   * used, so refreshes see the same cache they always did.
   */
  fetcher?: DataFetcher;
  /**
   * A load already in flight (or settled) per named source id: the source's
   * FIRST load awaits it instead of requesting the data again. Refreshes
   * fetch as usual.
   */
  pending?: Record<string, Promise<FeatureCollection>>;
  /**
   * Whether a URL protocol is registered on the maplibre-gl module (unused
   * since COG is read YAML-only, ml-cnv.2; kept for callers)
   * (ml-cnv). Injected by `MapRenderer` so this module never loads
   * maplibre-gl itself; defaults to "none registered".
   */
  isProtocolRegistered?: (scheme: string) => boolean;
  /**
   * The GeoParquet columns the document reads per source id (ml-cnv.4,
   * `formats/columns`): injected by `MapRenderer`, which sees every layer
   * that draws from a source. Absent: every column is read.
   */
  columnsFor?: (sourceId: string) => readonly string[] | "all" | undefined;
  /**
   * The named sources a highlighted layer draws from (ml-aot.142): injected
   * by `MapRenderer`, which sees every layer, because named sources are
   * added before any layer is. Each gets feature ids unless the author chose
   * an id strategy. Absent: none.
   */
  namedSourcesNeedingIds?: ReadonlySet<string>;
}

/**
 * Manages map layers and their data sources
 */
export class LayerManager {
  private map: MapLibreMap;
  private callbacks: LayerManagerCallbacks;
  private dataFetcher: DataFetcher;
  /**
   * The live-data managers (polling, streaming, merging), null until a
   * source starts a pipeline and the `live` chunk is in (bundle headroom,
   * KTD6). Every stop, pause, resume and destroy below goes through
   * `this.live?.`: a no-op on a map that never refreshed.
   */
  private live: LiveData | null = null;
  /** `destroy()` ran: a pipeline whose chunk arrives afterwards never starts. */
  private destroyed = false;
  /** `pause()` ran and `resume()` has not: a pipeline that starts meanwhile starts paused. */
  private paused = false;
  /**
   * Streams that would have connected while {@link paused} (their `live`
   * chunk arrived meanwhile), by pipeline key: `resume()` connects them; a
   * stop or disconnect before then drops them (see {@link dropStream}).
   */
  private pausedStreams = new Map<string, { sourceId: string; config: GeoJSONSourceConfig }>();
  /**
   * Sources whose pipeline couldn't start because the `live` chunk didn't
   * download: they keep their first data, and `reload()` retries them
   * (they are among {@link failedSources}).
   */
  private liveUnavailable = new Set<string>();
  /**
   * Each `url:` source's first load, settled either way: a live-chunk
   * failure is reported after it, since the data landing takes that
   * layer's earlier lines off the notice.
   */
  private firstLoads = new Map<string, Promise<void>>();
  private sourceData: Map<string, FeatureCollection>;
  private layerToSource: Map<string, string>;
  /** Layer ids this manager has added (or is adding): a repeat is refused. */
  private claimedLayerIds = new Set<string>();
  /** Block-level `sources:` specs, kept for their YAML-only refresh config. */
  private namedSources: Map<string, Record<string, unknown>>;
  /** How many live layers reference each named source. */
  private sourceRefCounts: Map<string, number>;
  /** Named sources with a refresh/stream pipeline currently running. */
  private activeSourcePipelines: Set<string>;
  /**
   * How many times each named source's last layer went (`releaseNow`
   * reaching zero). A chunk wait spanning one starts nothing that release
   * would have stopped: the release found nothing running to stop.
   */
  private sourceReleases = new Map<string, number>();
  /**
   * Named-source releases held back until `settleSources()` (live documents,
   * KTD4): set between `beginSourceSettlement()` and `settleSources()`, so
   * a layer that loses a source mid-diff never tears it down before the
   * layer that gains it has claimed it. `null` outside a settlement window.
   */
  private pendingReleases: Map<string, number> | null = null;
  /**
   * `layer\0anchor` pairs already hinted about, so an update does not repeat a
   * `before:` hint (KTD3); and `\0source\0url\0key` for a reader's `once` hints (KTD14).
   */
  private hintedAnchors = new Set<string>();
  /** First loads a host already started, by source id (consumed once). */
  private pendingData: Map<string, Promise<FeatureCollection>>;
  /** Sources already told their `merge` updates carry keyless features (once each). */
  private keylessWarned = new Set<string>();
  /** FlatGeobuf / GeoParquet readers by source id (ml-cnv.3/.4), stopped with their source. */
  private formatLoaders = new Map<string, FormatLoader>();
  /** Whole-column scans by reader and column set (see `wholeColumns`); they go with their reader. */
  private columnScans = new WeakMap<FormatLoader, Map<string, Promise<FeatureCollection>>>();
  /** Whether the page registered a URL protocol itself (see LayerManagerDataOptions). */
  private isProtocolRegistered: (scheme: string) => boolean;
  /** The GeoParquet columns the document reads (see LayerManagerDataOptions). */
  private columnsFor: (sourceId: string) => readonly string[] | "all" | undefined;
  /** Named sources a highlighted layer draws from (see LayerManagerDataOptions). */
  private namedSourcesNeedingIds: ReadonlySet<string>;
  /**
   * Every source this manager handed to MapLibre, by id, as the document
   * gave it (named and inline alike): what a live update compares the next
   * document's source against to decide what changed (live documents, U3).
   */
  private sourceSpecs = new Map<string, Record<string, unknown>>();
  /**
   * Per source, the generation of its current load (live documents, KTD5):
   * bumped whenever the source is re-targeted, replaced or removed. Every
   * async continuation — a fetch, a reader's delivery, a polling tick —
   * carries the generation it started under and is dropped when it no
   * longer matches, so a slow response for a URL the document has since
   * left never lands over newer data.
   */
  private sourceGenerations = new Map<string, number>();
  /**
   * Sources whose last load failed (a fetch, a reader, a decoder chunk):
   * what the renderer builds `hints.failedSources` from, so `reload()`
   * retries them even when the document is unchanged (KTD11). A source
   * leaves the set when data lands, or when it is removed.
   */
  private failed = new Set<string>();
  /**
   * Tile and image sources (`url:`, `pmtiles://`, `cog://`) whose TileJSON or
   * image request failed — a reader chunk that didn't download, a wrong
   * path — as the renderer saw on the map's `error` event; it clears one
   * when its metadata loads. Among {@link failedSources}, and `setSourceUrl`
   * sets an unchanged url again for them, so `reload()` asks anew.
   */
  readonly tileJsonFailed = new Set<string>();
  /**
   * Where a document layer sat before {@link replaceSource} took it off the
   * map — the layer above it — so its re-add (`replaceLayer` with no
   * anchor) lands in the same slot.
   */
  private parkedAnchors = new Map<string, string | undefined>();

  constructor(
    map: MapLibreMap,
    callbacks?: LayerManagerCallbacks,
    data: LayerManagerDataOptions = {}
  ) {
    this.map = map;
    this.callbacks = callbacks || {};
    this.dataFetcher = data.fetcher ?? new DataFetcher();
    this.pendingData = new Map(Object.entries(data.pending ?? {}));
    this.isProtocolRegistered = data.isProtocolRegistered ?? (() => false);
    this.columnsFor = data.columnsFor ?? (() => undefined);
    this.namedSourcesNeedingIds = data.namedSourcesNeedingIds ?? new Set();
    this.sourceData = new Map();
    this.layerToSource = new Map();
    this.namedSources = new Map();
    this.sourceRefCounts = new Map();
    this.activeSourcePipelines = new Set();
  }

  /**
   * The named sources a highlighted layer draws from, for the next document
   * (live documents): `registerSources` reads this set when a source is
   * added or rebuilt, so an update that adds `hover.highlight` over a named
   * source — which the differ answers with a `generateId` replacement — gets
   * feature ids on the rebuilt source, not the first document's answer.
   */
  setNamedSourcesNeedingIds(ids: ReadonlySet<string>): void {
    this.namedSourcesNeedingIds = ids;
  }

  /**
   * Register the block's named `sources:` with MapLibre.
   *
   * @remarks
   * Owned here rather than in `MapRenderer`, which used to call
   * `map.addSource` directly. That bypassed every piece of refresh machinery,
   * so a named source could declare `refresh:` and never poll, and it leaked
   * YAML-only keys straight into MapLibre. Registration is idempotent so a
   * re-render does not duplicate sources.
   */
  registerSources(sources: Record<string, unknown>): void {
    for (const [id, spec] of Object.entries(sources)) {
      if (!spec || typeof spec !== "object") continue;
      this.namedSources.set(id, spec as Record<string, unknown>);
      this.sourceSpecs.set(id, spec as Record<string, unknown>);
      // Its refresh starts once the first data is in: the chunk comes alongside.
      if (startsLive(spec as unknown as GeoJSONSourceConfig)) prefetchDecoder("live");

      if (this.map.getSource(id)) continue;

      // `url` on a geojson source is our key, not MapLibre's (its geojson
      // sources take `data`), so passing it through makes style validation
      // throw and the whole document render abort. Route it through the same
      // DataFetcher path inline layer sources use: the source is added
      // synchronously with its initial data, the fetch resolves into
      // setData, and data events fire with the source id as their subject —
      // exactly like the refresh pipeline (startSourcePipeline) already does.
      const geojson = spec as unknown as GeoJSONSourceConfig;
      const needsIds = this.namedSourcesNeedingIds.has(id);
      if (geojson.type === "geojson" && geojson.url) {
        void this.addGeoJSONSourceFromURL(id, id, geojson, needsIds);
        continue;
      }

      const mapLibreSpec = this.toMapLibreSourceSpec(spec as any, id);
      if (geojson.type === "geojson") withFeatureIds(mapLibreSpec, geojson, needsIds);
      this.addMapSource(id, mapLibreSpec);
    }
  }

  /**
   * The one place this manager hands a source to MapLibre.
   *
   * @remarks
   * `attribution` is sanitized here because MapLibre renders it as HTML through
   * a bypassable sanitizer (GHSA-jrc7-96c5-q579). Every source path — inline,
   * named, url-fetched — funnels through this, so none can forget.
   */
  private addMapSource(id: string, spec: any): void {
    if (spec && typeof spec === "object" && spec.attribution !== undefined) {
      spec = { ...spec, attribution: sanitizeAttribution(spec.attribution).html };
    }
    this.map.addSource(id, spec);
  }

  /**
   * Strip keys that drive our own machinery rather than MapLibre's.
   *
   * @remarks
   * `refresh`, `cache`, `prefetchedData` and the legacy top-level refresh
   * fields are ours; passing them through leaves unknown keys on the source
   * spec MapLibre validates.
   */
  private toMapLibreSourceSpec(spec: Record<string, unknown>, sourceId?: string): any {
    const {
      refresh,
      cache,
      prefetchedData,
      refreshInterval,
      updateStrategy,
      updateKey,
      loading,
      stream,
      fetchStrategy,
      ...mapLibreSpec
    } = spec as Record<string, unknown>;
    // Same-origin vector tile paths must be absolute by the time MapLibre's
    // worker fetches them (see utils/tile-url).
    return absolutizeVectorTiles(this.resolveTileSource(mapLibreSpec, sourceId));
  }

  /**
   * A tile source's spec with its cloud-native URL resolved (a PMTiles URL
   * becomes `pmtiles://<absolute>`) and our `format`/`load` keys removed. A
   * format this version can't read is reported and replaced by an empty
   * placeholder of the same type (ml-cnv).
   */
  private resolveTileSource(
    spec: Record<string, unknown>,
    sourceId?: string
  ): Record<string, unknown> {
    const type = spec["type"];
    if (type !== "vector" && type !== "raster" && type !== "raster-dem") {
      return withoutFormatKeys(spec);
    }
    const resolved = toMapLibreTileSpec(spec, this.isProtocolRegistered);
    if (resolved.problem && sourceId) this.callbacks.onSourceError?.(sourceId, resolved.problem);
    // Absolute against the page: the worker fetches some of these, and a
    // relative URL is reserved for a basemap style's own files (basemap-urls).
    return absolutizeSourceUrls(resolved.spec);
  }

  /**
   * The GeoJSON this manager last delivered to a fetched/refreshed source, by
   * source id — what `fitTo` (U14) frames once a `url:` source's first fetch
   * lands. Undefined for sources whose data never passed through here.
   */
  getSourceData(sourceId: string): FeatureCollection | undefined {
    return this.sourceData.get(sourceId);
  }

  /** The MapLibre source a layer draws from. */
  getSourceIdForLayer(layerId: string): string | undefined {
    return this.layerToSource.get(layerId);
  }

  /**
   * Start the refresh/stream pipeline for a named source, once.
   *
   * @remarks
   * Keyed by source id, not layer id: two layers over one source share one
   * poll. `data-loaded`/`data-error` still fire per referencing layer, so
   * consumers listening on a layer see what they always did.
   */
  private async startSourcePipeline(sourceId: string): Promise<void> {
    const spec = this.namedSources.get(sourceId);
    if (!spec) return;
    if (this.activeSourcePipelines.has(sourceId)) return; // already polling

    const source = spec as unknown as GeoJSONSourceConfig;
    if (source.type !== "geojson") return;
    if (!source.refresh && !source.refreshInterval) return;

    this.activeSourcePipelines.add(sourceId);
    // Keyed by source id: one poll serves every layer over this source.
    await this.setupDataUpdates(sourceId, sourceId, source);
  }

  /**
   * Drop one layer's claim on a named source; the pipeline stops once
   * nothing references it. Inside a settlement window the release is only
   * recorded (see {@link beginSourceSettlement}).
   */
  private releaseSource(sourceId: string): void {
    if (this.pendingReleases) {
      this.pendingReleases.set(sourceId, (this.pendingReleases.get(sourceId) ?? 0) + 1);
      return;
    }
    this.releaseNow(sourceId, 1);
  }

  /** Drop `count` claims on a named source now. Returns whether it reached zero. */
  private releaseNow(sourceId: string, count: number): boolean {
    const remaining = (this.sourceRefCounts.get(sourceId) ?? count) - count;

    if (remaining > 0) {
      this.sourceRefCounts.set(sourceId, remaining);
      return false; // siblings still need the data
    }

    this.sourceRefCounts.delete(sourceId);
    this.sourceReleases.set(sourceId, (this.sourceReleases.get(sourceId) ?? 0) + 1);
    if (this.activeSourcePipelines.delete(sourceId)) {
      this.live?.polling.stop(sourceId);
      this.dropStream(sourceId);
    }
    // Shared: the data stayed as long as a sibling drew from it. Nothing
    // draws it now: a file read by view stops reading on every move, and
    // its "zoom in" line goes with its last layer (ml-cnv.32).
    this.sourceData.delete(sourceId);
    this.formatLoaders.get(sourceId)?.suspend?.();
    return true;
  }

  /**
   * Hold named-source releases until {@link settleSources} (live documents,
   * KTD4). Claims still count immediately, so during the window a source's
   * count is never below its true value and nothing is torn down early.
   */
  beginSourceSettlement(): void {
    this.pendingReleases ??= new Map();
  }

  /**
   * Apply the releases held since {@link beginSourceSettlement}. Returns the
   * named sources whose count reached zero: their pipelines are stopped,
   * their MapLibre source is left for the caller (see {@link removeSource}).
   */
  settleSources(): string[] {
    const pending = this.pendingReleases;
    this.pendingReleases = null;
    const zeroed: string[] = [];
    for (const [sourceId, count] of pending ?? []) {
      if (this.releaseNow(sourceId, count)) zeroed.push(sourceId);
    }
    return zeroed;
  }

  /** A mark to compare with {@link releasedSince} after a wait. */
  private releaseMark(sourceId: string): number {
    return this.sourceReleases.get(sourceId) ?? 0;
  }

  /** Whether a named source's last layer went since `mark` (see `sourceReleases`). */
  private releasedSince(sourceId: string, mark: number): boolean {
    return this.releaseMark(sourceId) !== mark;
  }

  /** How many document layers draw a named source (pending releases not yet subtracted). */
  sourceRefCount(sourceId: string): number {
    return this.sourceRefCounts.get(sourceId) ?? 0;
  }

  /** Whether this manager added `layerId` — a document layer, as opposed to a host's. */
  ownsLayer(layerId: string): boolean {
    return this.claimedLayerIds.has(layerId);
  }

  /**
   * Remove a named source the document no longer declares (live documents,
   * U2). Refused — the source is left in place — while a document layer
   * still draws it, or while any layer on the map the document did not
   * declare does (KTD4: a host's layer over a document source).
   */
  removeSource(sourceId: string): void {
    const refs = this.sourceRefCount(sourceId);
    if (refs > 0) {
      throw new Error(`Source "${sourceId}" is still drawn by ${refs} document layer${refs === 1 ? "" : "s"}, so it is left in place.`);
    }
    const users = this.styleLayers()
      .filter((l) => l.source === sourceId)
      .map((l) => l.id);
    if (users.length > 0) {
      throw new Error(
        `Source "${sourceId}" is still used by ${users.map((id) => `"${id}"`).join(", ")}, ` +
          `which the document did not declare, so it is left in place. Remove that layer before removing the source.`
      );
    }
    if (this.activeSourcePipelines.delete(sourceId)) {
      this.live?.polling.stop(sourceId);
      this.dropStream(sourceId);
    }
    this.forgetSource(sourceId);
    this.namedSources.delete(sourceId);
    if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
  }

  /**
   * Drop everything this manager holds for a source that is going away or
   * being rebuilt: its reader, data, failure state, pending load and spec.
   * The generation moves on, so any load still in flight for it is dropped.
   */
  private forgetSource(sourceId: string): void {
    this.nextGeneration(sourceId);
    this.formatLoaders.get(sourceId)?.destroy();
    this.formatLoaders.delete(sourceId);
    this.sourceData.delete(sourceId);
    this.failed.delete(sourceId);
    this.tileJsonFailed.delete(sourceId);
    this.keylessWarned.delete(sourceId);
    this.pendingData.delete(sourceId);
    this.sourceSpecs.delete(sourceId);
    this.liveUnavailable.delete(sourceId);
    this.firstLoads.delete(sourceId);
  }

  /**
   * The sources whose last load failed (see the field), and those whose
   * live updates couldn't start for want of the `live` chunk. A copy: safe
   * to hold across an update.
   */
  failedSources(): ReadonlySet<string> {
    return new Set([...this.failed, ...this.liveUnavailable, ...this.tileJsonFailed]);
  }

  /** The next generation for a source's loads (see `sourceGenerations`). */
  private nextGeneration(sourceId: string): number {
    const generation = (this.sourceGenerations.get(sourceId) ?? 0) + 1;
    this.sourceGenerations.set(sourceId, generation);
    return generation;
  }

  /** Whether a continuation started under `generation` is still the source's current load. */
  private isCurrent(sourceId: string, generation: number): boolean {
    return this.sourceGenerations.get(sourceId) === generation;
  }

  /**
   * The key a source's pipeline runs under and the layer its data events
   * name: a named source runs under its own id (one poll for every layer
   * over it); an inline source runs under its layer.
   */
  private pipelineOwner(sourceId: string): { key: string; layerId: string } {
    if (this.namedSources.has(sourceId)) return { key: sourceId, layerId: sourceId };
    for (const [layerId, id] of this.layerToSource) {
      // The one rule for a layer's pipeline key (`pipelineKeyFor`): its own id for an inline source.
      if (id === sourceId) return { key: this.pipelineKeyFor(layerId), layerId };
    }
    return { key: sourceId, layerId: sourceId };
  }

  /** Disconnect the stream under `key`, or forget one waiting for `resume()`. */
  private dropStream(key: string): void {
    this.pausedStreams.delete(key);
    this.live?.streams.disconnect(key);
  }

  /** Whether a stream runs under `key`, or waits for `resume()` to connect. */
  private hasStream(key: string): boolean {
    return this.pausedStreams.has(key) || Boolean(this.live?.streams.getState(key));
  }

  /** Stop a source's poll and stream, whatever key they run under. */
  private stopPipeline(sourceId: string): void {
    const { key } = this.pipelineOwner(sourceId);
    this.live?.polling.stop(key);
    this.dropStream(key);
    this.activeSourcePipelines.delete(sourceId);
  }

  /** Record the next document's spec for a source as the one on the map. */
  private rememberSpec(sourceId: string, spec: Record<string, unknown>): void {
    this.sourceSpecs.set(sourceId, spec);
    if (this.namedSources.has(sourceId)) this.namedSources.set(sourceId, spec);
  }

  /** A tile source's spec as MapLibre sees it; `sourceId` reports a format problem, no id keeps quiet. */
  private resolvedTileSpec(spec: Record<string, unknown>, sourceId?: string): Record<string, unknown> {
    return this.toMapLibreSourceSpec(spec, sourceId) as Record<string, unknown>;
  }

  /**
   * Replace a GeoJSON source's data in place (live documents, U3): an
   * inline `data:` edit, or a named source's. Layers over it hear
   * `data-loaded` as they do after a refresh, so classify breaks and the
   * host's feature-state reset follow the new data.
   */
  setSourceData(sourceId: string, data: FeatureCollection): void {
    if (!this.map.getSource(sourceId)) {
      throw new Error(`Source "${sourceId}" is not on the map, so its data cannot be set.`);
    }
    this.nextGeneration(sourceId);
    this.deliverSourceData(sourceId, this.pipelineOwner(sourceId).layerId, data);
  }

  /**
   * Point a source at another URL in place (live documents, KTD4). A GeoJSON
   * source is fetched again through the same path first render uses and
   * `setData` applied when the response is still current; its live-data
   * pipeline is re-targeted. A tile, image or video source goes through
   * MapLibre's own setter.
   *
   * @returns false when the running maplibre-gl has no setter for this
   *   source (RasterTileSource gained `setUrl` in 4.0): the caller replaces
   *   the source instead.
   */
  async setSourceUrl(sourceId: string, next: Record<string, unknown>): Promise<boolean> {
    const source = this.map.getSource(sourceId) as
      | { setUrl?: (url: string) => unknown; updateImage?: (options: { url: string }) => unknown }
      | undefined;
    if (!source) throw new Error(`Source "${sourceId}" is not on the map, so its url cannot be set.`);
    const prev = this.sourceSpecs.get(sourceId);
    if (next["type"] === "geojson") {
      const reload = !prev || prev["url"] !== next["url"] || this.failed.has(sourceId);
      await this.retargetPipeline(sourceId, next, { reload });
      return true;
    }
    const resolved = this.resolvedTileSpec(next, sourceId);
    const url = resolved["url"];
    if (typeof source.setUrl === "function") {
      const before = prev ? this.resolvedTileSpec(prev)["url"] : undefined;
      if (typeof url === "string" && (url !== before || this.tileJsonFailed.has(sourceId))) source.setUrl(url);
      this.rememberSpec(sourceId, next);
      return true;
    }
    if (next["type"] === "image" && typeof source.updateImage === "function" && typeof url === "string") {
      source.updateImage({ url });
      this.rememberSpec(sourceId, next);
      return true;
    }
    return false;
  }

  /**
   * Point a tile source at other tile URLs in place through `setTiles`
   * (live documents, KTD4), resolved as on first render.
   *
   * @returns false when the running maplibre-gl has no `setTiles` on this
   *   source (RasterTileSource gained it in 3.5): the caller replaces the
   *   source instead.
   */
  setSourceTiles(sourceId: string, next: Record<string, unknown>): boolean {
    const source = this.map.getSource(sourceId) as { setTiles?: (tiles: string[]) => unknown } | undefined;
    if (!source) throw new Error(`Source "${sourceId}" is not on the map, so its tiles cannot be set.`);
    if (typeof source.setTiles !== "function") return false;
    const prev = this.sourceSpecs.get(sourceId);
    const tiles = this.resolvedTileSpec(next, sourceId)["tiles"];
    const before = prev ? this.resolvedTileSpec(prev)["tiles"] : undefined;
    if (Array.isArray(tiles) && !sameJson(tiles, before)) source.setTiles(tiles as string[]);
    this.rememberSpec(sourceId, next);
    return true;
  }

  /**
   * Bring a GeoJSON source's pipeline in line with the next document's
   * config (live documents, U3), touching only what changed: an interval
   * change reschedules the running poll; a change to what the poll captured
   * (URL, cache, merge options) restarts it; `refresh` removed stops it,
   * added starts it; a `stream` change reconnects; a FlatGeobuf or
   * GeoParquet source whose reader options changed gets a new reader. A
   * merge-strategy change drops the features accumulated under the old
   * strategy and fetches at once, so the map never shows a mix.
   *
   * @param options.reload - Fetch the URL again now (it changed, or its
   *   last load failed) and `setData` the response if it is still current.
   */
  async retargetPipeline(sourceId: string, next: Record<string, unknown>, options: { reload?: boolean } = {}): Promise<void> {
    const prev = this.sourceSpecs.get(sourceId);
    this.rememberSpec(sourceId, next);
    if (next["type"] !== "geojson") return;
    const before = prev as GeoJSONSourceConfig | undefined;
    const after = next as unknown as GeoJSONSourceConfig;
    // A pipeline this edit starts: its chunk comes alongside, as for a new source.
    if (startsLive(after)) prefetchDecoder("live");
    const owner = this.pipelineOwner(sourceId);

    if (this.isFormatSource(after)) {
      const changed = !before || !this.isFormatSource(before) || loaderShape(before) !== loaderShape(after);
      if (changed || options.reload) await this.recreateLoader(sourceId, next);
      return;
    }
    if (before && this.isFormatSource(before)) {
      this.formatLoaders.get(sourceId)?.destroy();
      this.formatLoaders.delete(sourceId);
    }

    const strategyChanged = before !== undefined && strategyOf(before) !== strategyOf(after);
    if (strategyChanged) {
      // What `merge` / `append-window` built up belongs to the old strategy.
      this.nextGeneration(sourceId);
      this.sourceData.set(sourceId, emptyCollection());
    }
    if (options.reload && after.url) void this.fetchInto(sourceId, owner.layerId, after);

    // A source whose live updates never started (the `live` chunk didn't
    // download): this retry starts what its document asks for.
    this.liveUnavailable.delete(sourceId);
    const interval = intervalOf(after);
    if (interval && after.url) {
      const running = this.live?.polling.has(owner.key) ?? false;
      if (running && intervalOf(before) && pollingShape(before) === pollingShape(after)) {
        if (intervalOf(before) !== interval) this.live!.polling.setInterval(owner.key, interval);
      } else {
        this.live?.polling.stop(owner.key);
        await this.startPolling(owner.key, sourceId, after, strategyChanged && !options.reload);
      }
    } else {
      this.live?.polling.stop(owner.key);
    }

    // A changed stream reconnects; one the document asks for that isn't
    // running connects — its chunk failed (this is the retry), or this edit
    // landed while the chunk downloaded and the first start gave way to it.
    if (streamShape(before) !== streamShape(after) || (after.stream && !this.hasStream(owner.key))) {
      this.dropStream(owner.key);
      if (after.stream) await this.startStream(owner.key, sourceId, after);
    }

    if (this.namedSources.has(sourceId)) {
      if (this.live?.polling.has(owner.key) || this.hasStream(owner.key)) this.activeSourcePipelines.add(sourceId);
      else this.activeSourcePipelines.delete(sourceId);
    }
  }

  /**
   * Destroy a FlatGeobuf or GeoParquet source's reader and start one from
   * the next document's source (live documents, U3). A reader suspended
   * because nothing draws the source stays suspended; a read the old reader
   * still had in flight never lands (its generation is over).
   */
  async recreateLoader(sourceId: string, next: Record<string, unknown>): Promise<void> {
    const previous = this.formatLoaders.get(sourceId);
    const suspended = previous
      ? previous.suspended === true
      : this.namedSources.has(sourceId) && this.sourceRefCount(sourceId) === 0;
    this.nextGeneration(sourceId);
    this.stopPipeline(sourceId);
    this.rememberSpec(sourceId, next);
    const config = next as unknown as GeoJSONSourceConfig;
    const { layerId } = this.pipelineOwner(sourceId);
    const format = formatOfSource(config);
    // Not awaited: the update completes when its operations are applied, not when the file is read.
    if (format === "flatgeobuf") void this.startFlatGeobuf(sourceId, layerId, config, suspended);
    else if (format === "geoparquet" && typeReadsFormat(config.type, format)) void this.startGeoParquet(sourceId, layerId, config, suspended);
    else {
      previous?.destroy();
      this.formatLoaders.delete(sourceId);
    }
  }

  /**
   * Rebuild a named source from the next document's spec (live documents,
   * KTD4): for a change MapLibre has no setter for, or a setter the running
   * maplibre-gl lacks. The document layers over it are taken off the map
   * (their slot remembered, see `parkedAnchors`) for the caller to add again
   * through `replaceLayer`; the source is removed and registered anew, so a
   * `url:` fetches again. Refused — nothing changes — while a layer the
   * document did not declare still draws it.
   */
  replaceSource(sourceId: string, next: Record<string, unknown>): void {
    if (!this.namedSources.has(sourceId)) {
      throw new Error(`Source "${sourceId}" is not one of the document's named sources, so it cannot be replaced on its own.`);
    }
    const users = this.styleLayers().filter((l) => l.source === sourceId);
    const foreign = users.filter((l) => !this.claimedLayerIds.has(l.id)).map((l) => l.id);
    if (foreign.length > 0) {
      throw new Error(
        `Source "${sourceId}" is still used by ${foreign.map((id) => `"${id}"`).join(", ")}, ` +
          `which the document did not declare, so it is left as it is and its change is not applied. ` +
          `Remove that layer, or give the document's source another id.`
      );
    }
    for (const { id } of users) {
      this.parkedAnchors.set(id, this.successorOf(id));
      this.map.removeLayer(id);
    }
    this.stopPipeline(sourceId);
    this.forgetSource(sourceId);
    if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
    this.registerSources({ [sourceId]: next });
  }

  /**
   * Fetch a GeoJSON `url:` again and `setData` the response, dropping it
   * when the source moved on meanwhile (KTD5). Failures are reported as on
   * first load and remembered for `hints.failedSources`.
   */
  private async fetchInto(sourceId: string, layerId: string, config: GeoJSONSourceConfig): Promise<void> {
    const generation = this.nextGeneration(sourceId);
    for (const target of this.layersForPipeline(sourceId, layerId)) this.callbacks.onDataLoading?.(target);
    try {
      const data = await loadSourceData(config as typeof config & { url: string }, { fetcher: this.dataFetcher });
      if (!this.isCurrent(sourceId, generation)) return;
      this.deliverSourceData(sourceId, layerId, data);
    } catch (error) {
      if (!this.isCurrent(sourceId, generation)) return;
      this.failed.add(sourceId);
      this.callbacks.onDataError?.(layerId, error as Error);
    }
  }

  /** New data for a source: remembered, set on the map, announced to every layer over it. */
  private deliverSourceData(sourceId: string, layerId: string, data: FeatureCollection): void {
    this.sourceData.set(sourceId, data);
    this.failed.delete(sourceId);
    const source = this.map.getSource(sourceId) as GeoJSONSource | undefined;
    // setData's promise (maplibre-gl 6) never rejects: a worker failure fires the map's `error` event.
    void source?.setData?.(data);
    for (const target of this.layersForPipeline(sourceId, layerId)) {
      this.callbacks.onDataLoaded?.(target, data.features.length);
    }
  }

  /** The style's layers, as `{ id, source }` records; empty when there is no style to read. */
  private styleLayers(): { id: string; source?: string }[] {
    try {
      return (this.map.getStyle?.()?.layers ?? []) as { id: string; source?: string }[];
    } catch {
      return [];
    }
  }

  /** Whether a refresh/stream pipeline is running for a named source. */
  isRefreshing(sourceId: string): boolean {
    return this.activeSourcePipelines.has(sourceId);
  }

  /**
   * Add a document layer. `beforeId` (live documents, U2) is where an update
   * puts it — the next document layer — and wins over the layer's own
   * `before:` while the map has it; otherwise `before:` is honoured as on
   * first render. `awaitData` (default on, first render's `load` contract:
   * every layer added and its data in) resolves once the layer's inline
   * `url:` has been read; off — a live update, which completes when its
   * operations are applied — the layer is placed with its source and the
   * read goes on as a generation-guarded task, as a named source's does.
   */
  async addLayer(layer: Layer, beforeId?: string, options: LayerAddOptions = {}): Promise<void> {
    // A document that repeats a layer id (review F3): the first one wins, as
    // in 0.8.0, and the repeat is refused here -- synchronously, before any
    // await, so the first in document order claims the id even when the
    // layers are added concurrently, and before the repeat can add a second
    // `<id>-source` or bump a shared source's refcount. The caller reports
    // the message on the map. (A clash with a basemap layer is left to
    // MapLibre, as before.)
    if (this.claimedLayerIds.has(layer.id)) {
      throw new Error(
        `Another layer already has id "${layer.id}": the first one is drawn and this ` +
          `one is skipped. Give each layer its own id.`
      );
    }
    this.claimedLayerIds.add(layer.id);
    try {
      await this.addClaimedLayer(layer, beforeId, options.awaitData !== false);
    } catch (error) {
      // A layer that failed to add holds no id, no source claim and no inline
      // source: a later retry is not a repeat, and a named source's count
      // reflects the layers that draw it (live documents, KTD4).
      this.removeLayer(layer.id);
      throw error;
    }
  }

  /**
   * Replace a document layer in place (live documents, U2): removed and
   * added again through the same claim path as a fresh add, so the
   * `hover.highlight` paint wrapping and the `generateId` rule
   * (ml-aot.142) apply to the replacement. Tolerates a layer the host
   * already removed from the map. With no `beforeId` the layer keeps its
   * slot on the map (its current successor, host layers included).
   */
  async replaceLayer(layer: Layer, beforeId?: string, options: LayerAddOptions = {}): Promise<void> {
    const anchor = beforeId ?? this.successorOf(layer.id) ?? this.parkedAnchors.get(layer.id);
    this.removeLayer(layer.id);
    await this.addLayer(layer, anchor, options);
  }

  /**
   * Move a document layer before `beforeId`, or to the top (live documents,
   * KTD3). Host layers — anything this manager did not add — are never
   * moved; an anchor the map lacks means the top.
   */
  moveLayer(layerId: string, beforeId?: string): void {
    if (!this.claimedLayerIds.has(layerId)) {
      throw new Error(`Layer "${layerId}" was not declared by the document, so it is not moved.`);
    }
    if (!this.map.getLayer(layerId)) {
      throw new Error(`Layer "${layerId}" is not on the map, so it cannot be moved.`);
    }
    const anchor = beforeId !== undefined && this.map.getLayer(beforeId) ? beforeId : undefined;
    this.map.moveLayer(layerId, anchor);
  }

  /**
   * Set one live-settable property of a document layer (live documents,
   * U2): `paint`, `layout`, `filter` (`undefined` clears), `zoom`
   * (`minzoom` / `maxzoom`; `undefined` restores the layer defaults) or
   * `visibility`. Values are the next document's; nothing is read back from
   * the map (R10). Host layers — anything this manager did not add — are
   * never touched (KTD1), as `moveLayer` never moves them.
   */
  setLayerProperty(
    layerId: string,
    target: "paint" | "layout" | "filter" | "zoom" | "visibility",
    property: string,
    value: unknown
  ): void {
    if (!this.claimedLayerIds.has(layerId)) {
      throw new Error(`Layer "${layerId}" was not declared by the document, so "${property}" is not set.`);
    }
    if (!this.map.getLayer(layerId)) {
      throw new Error(`Layer "${layerId}" is not on the map, so "${property}" cannot be set.`);
    }
    switch (target) {
      case "paint":
        // The property name is the document's, not one of MapLibre's keyed unions.
        this.map.setPaintProperty(layerId, property as any, value);
        return;
      case "layout":
        this.map.setLayoutProperty(layerId, property as any, value);
        return;
      case "filter":
        this.map.setFilter(layerId, (value ?? null) as any);
        return;
      case "zoom":
        if (property === "minzoom") this.map.setLayerZoomRange(layerId, (value as number | undefined) ?? 0, null as any);
        else this.map.setLayerZoomRange(layerId, null as any, (value as number | undefined) ?? 24);
        return;
      case "visibility":
        this.map.setLayoutProperty(layerId, "visibility", value === "none" ? "none" : "visible");
        return;
    }
  }

  /** The id of the layer right above `layerId` on the map; undefined on top or when absent. */
  private successorOf(layerId: string): string | undefined {
    const layers = this.styleLayers();
    const index = layers.findIndex((l) => l.id === layerId);
    return index >= 0 ? layers[index + 1]?.id : undefined;
  }

  /**
   * The layer's `before:`, when it names a layer that is on the map (or one
   * of this document's own, still being added). A name that is neither — a
   * typo, a basemap layer id from another basemap — made MapLibre refuse the
   * layer, which then vanished with only a console error (ml-aot.119): it
   * goes on top instead, with an author hint naming the closest layer id.
   */
  private beforeOrTop(layer: Layer): string | undefined {
    const before = layer.before;
    if (typeof before !== "string") return undefined;
    if (typeof this.map.getLayer !== "function" || this.map.getLayer(before)) return before;
    if (this.claimedLayerIds.has(before)) return before;
    let styleLayers: string[] = [];
    try {
      styleLayers = (this.map.getStyle?.()?.layers ?? []).map((l: { id: string }) => l.id);
    } catch {
      // No style to read: no did-you-mean.
    }
    const near = suggest(before, [...styleLayers, ...this.claimedLayerIds], 3);
    this.hintOnce(
      layer.id,
      before,
      `Layer \`${layer.id}\`: \`before: ${before}\` names no layer on this map, so the layer is drawn on top instead.` +
        (near ? ` Did you mean \`${near}\`?` : "")
    );
    return undefined;
  }

  /**
   * An author hint about a layer's `before:` anchor, once per layer and
   * anchor for the life of this manager: a live update re-adds and
   * re-places layers, and the same hint on every update is noise (KTD3).
   */
  hintOnce(layerId: string, anchor: string, message: string): void {
    if (this.firstHint(`${layerId}\0${anchor}`)) this.callbacks.onLayerHint?.(layerId, message);
  }

  /** Whether `key` is new to {@link hintedAnchors} (recording it): a hint shown once for this manager's life. */
  private firstHint(key: string): boolean {
    if (this.hintedAnchors.has(key)) return false;
    this.hintedAnchors.add(key);
    return true;
  }

  /** `beforeId` when the map has it, else the layer's own `before:` handling. */
  private resolveBefore(layer: Layer, beforeId: string | undefined): string | undefined {
    if (beforeId !== undefined && typeof this.map.getLayer === "function" && this.map.getLayer(beforeId)) return beforeId;
    return this.beforeOrTop(layer);
  }

  private async addClaimedLayer(layer: Layer, beforeId: string | undefined, awaitData: boolean): Promise<void> {
    // Background layers are sourceless by spec — resolving a source for one
    // dereferenced `layer.source.type` on undefined and threw, so a
    // schema-valid background layer killed the whole document (ml-chf).
    const isBackground = layer.type === "background";

    // If source is a string reference (named source), use it directly;
    // otherwise generate a source ID for inline source objects
    const isSourceRef = !isBackground && typeof layer.source === "string";
    const sourceId = isSourceRef ? layer.source as string : `${layer.id}-source`;

    if (!isBackground) {
      this.layerToSource.set(layer.id, sourceId);

      if (isSourceRef) {
        // One pipeline per source id regardless of how many layers reference it.
        const refs = (this.sourceRefCounts.get(sourceId) ?? 0) + 1;
        this.sourceRefCounts.set(sourceId, refs);
        // A file read by view that no layer drew follows the map again.
        if (refs === 1) this.formatLoaders.get(sourceId)?.resume?.();
        if (!this.map.getSource(sourceId)) {
          // Name the nearest source that does exist — the document's own or
          // the basemap style's — since a typo is the usual cause (ml-aot.15).
          let styleSources: string[] = [];
          try {
            styleSources = Object.keys(this.map.getStyle?.()?.sources ?? {});
          } catch {
            // No style to read (a test double, a torn-down map): no hint.
          }
          const hint = suggest(sourceId, [...this.namedSources.keys(), ...styleSources]);
          throw new Error(
            `Source "${sourceId}" doesn't exist.` +
              (hint ? ` Did you mean "${hint}"?` : "") +
              ` Declare it under sources:, or name a source from the basemap style.`
          );
        }
      } else {
        await this.addSource(sourceId, layer, awaitData);
      }
    }

    const layerSpec: any = {
      id: layer.id,
      type: layer.type,
    };
    if (!isBackground) layerSpec.source = sourceId;

    if ("paint" in layer && layer.paint) layerSpec.paint = layer.paint;

    // `hover.highlight` is only visible if some paint property reads the hover
    // feature-state, so wire it into the layer's primary color here.
    if (isHighlightEnabled(layer)) {
      applyHighlightPaint(layerSpec, layer);
    }
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

    this.map.addLayer(layerSpec, this.resolveBefore(layer, beforeId));

    // A named source refreshes once for the whole source, not once per layer.
    if (isSourceRef) {
      await this.startSourcePipeline(sourceId);
      return;
    }

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

  private async addSource(sourceId: string, layer: Layer, awaitData: boolean): Promise<void> {
    // layer.source is guaranteed to be an object (string refs handled in addLayer)
    const source = layer.source as { type: string };
    this.sourceSpecs.set(sourceId, source as unknown as Record<string, unknown>);

    if (source.type === "geojson") {
      const geojsonSource = source as unknown as GeoJSONSourceConfig;
      // Its refresh starts once the first data is in: the chunk comes alongside.
      if (startsLive(geojsonSource)) prefetchDecoder("live");

      if (geojsonSource.url) {
        await this.addGeoJSONSourceFromURL(
          sourceId,
          layer.id,
          geojsonSource,
          isHighlightEnabled(layer),
          awaitData
        );
      } else if (geojsonSource.data) {
        const sourceSpec: any = {
          type: "geojson",
          data: geojsonSource.data,
        };

        withFeatureIds(sourceSpec, geojsonSource, isHighlightEnabled(layer));

        // Only add clustering properties if they are defined
        if (geojsonSource.cluster !== undefined) sourceSpec.cluster = geojsonSource.cluster;
        if (geojsonSource.clusterRadius !== undefined) sourceSpec.clusterRadius = geojsonSource.clusterRadius;
        if (geojsonSource.clusterMaxZoom !== undefined) sourceSpec.clusterMaxZoom = geojsonSource.clusterMaxZoom;
        if (geojsonSource.clusterMinPoints !== undefined) sourceSpec.clusterMinPoints = geojsonSource.clusterMinPoints;
        if (geojsonSource.clusterProperties !== undefined) sourceSpec.clusterProperties = geojsonSource.clusterProperties;

        // The remaining MapLibre geojson options the schema accepts. Dropping
        // them silently disabled features that need them — line-gradient
        // needs lineMetrics, found by the gallery gradient pages (ml-tfd.8
        // family: forward what the schema accepted).
        if (geojsonSource.lineMetrics !== undefined) sourceSpec.lineMetrics = geojsonSource.lineMetrics;
        if (geojsonSource.tolerance !== undefined) sourceSpec.tolerance = geojsonSource.tolerance;
        if (geojsonSource.buffer !== undefined) sourceSpec.buffer = geojsonSource.buffer;
        if (geojsonSource.maxzoom !== undefined) sourceSpec.maxzoom = geojsonSource.maxzoom;
        if (geojsonSource.attribution !== undefined) sourceSpec.attribution = geojsonSource.attribution;

        this.addMapSource(sourceId, sourceSpec);
      }
      // No stream-only branch: validation refuses a GeoJSON source with only
      // `stream:` (it starts from `url:` or `data:`), so one never reaches
      // here from a validated document (ml-aot.134).
    } else if (source.type === "vector") {
      const vectorSource = this.resolveTileSource(
        source as unknown as Record<string, unknown>,
        sourceId
      ) as unknown as VectorSourceConfig;
      const vectorSpec: any = { type: "vector" };
      if (vectorSource.url) vectorSpec.url = vectorSource.url;
      if (vectorSource.tiles)
        vectorSpec.tiles = vectorSource.tiles.map((t) => absolutizeTileTemplate(t));
      if (vectorSource.minzoom !== undefined)
        vectorSpec.minzoom = vectorSource.minzoom;
      if (vectorSource.maxzoom !== undefined)
        vectorSpec.maxzoom = vectorSource.maxzoom;
      if (vectorSource.bounds) vectorSpec.bounds = vectorSource.bounds;
      if (vectorSource.attribution)
        vectorSpec.attribution = vectorSource.attribution;
      this.addMapSource(sourceId, vectorSpec);
    } else if (source.type === "raster") {
      const rasterSource = this.resolveTileSource(
        source as unknown as Record<string, unknown>,
        sourceId
      ) as unknown as RasterSourceConfig;
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
      this.addMapSource(sourceId, rasterSpec);
    } else if (source.type === "raster-dem") {
      // Forwarded whole rather than field-by-field: the schema is passthrough,
      // and `encoding: custom` is meaningless without the redFactor/
      // greenFactor/blueFactor/baseShift that come with it. A whitelist would
      // drop those silently and leave custom encodings decoding as mapbox.
      // Safe to spread — raster-dem carries no YAML-only keys to scrub (unlike
      // geojson's refresh/cache/prefetchedData). This also matches how
      // block-level named sources reach MapLibre.
      const demSource = this.resolveTileSource(
        source as unknown as Record<string, unknown>,
        sourceId
      ) as unknown as RasterDEMSourceConfig;
      this.addMapSource(sourceId, {
        ...demSource,
        type: "raster-dem",
      } as any);
    } else if (source.type === "image") {
      const imageSource = source as unknown as ImageSourceConfig;
      this.addMapSource(sourceId, {
        type: "image",
        url: imageSource.url,
        coordinates: imageSource.coordinates,
      });
    } else if (source.type === "video") {
      const videoSource = source as unknown as VideoSourceConfig;
      this.addMapSource(sourceId, {
        type: "video",
        urls: videoSource.urls,
        coordinates: videoSource.coordinates,
      });
    } else {
      // Falling through silently left the layer pointing at a source that
      // was never added — MapLibre then killed the document with an opaque
      // style error (ml-tfd.8). The common cause is a `$ref` in a standalone
      // block, which parses cleanly but nothing ever resolves.
      const detail =
        "$ref" in (source as Record<string, unknown>)
          ? `a "$ref" reference, which only resolves inside a "pages:" document`
          : `an unrecognized source (type: ${JSON.stringify((source as any).type)})`;
      throw new Error(
        `Layer "${layer.id}" has ${detail}. ` +
          `Inline the source or use a block-level named source.`
      );
    }
  }

  /**
   * Add a GeoJSON source whose data arrives by `url:` (or was prefetched):
   * the source goes on the map at once with its initial data, then the
   * read — a JSON fetch, or a FlatGeobuf / GeoParquet reader — fills it.
   * With `awaitData` the returned promise settles when the read has (first
   * render's contract); without it the read goes on as a task under the
   * source's current generation, failures reported as on first load, and
   * the promise settles once the source is placed (live documents, KTD5).
   */
  private async addGeoJSONSourceFromURL(
    sourceId: string,
    layerId: string,
    config: GeoJSONSourceConfig,
    needsIds = false,
    awaitData = true
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

    // Same passthrough as the inline-data path (line-gradient needs
    // lineMetrics; dropping schema-accepted options silently disables the
    // features that read them).
    if (config.lineMetrics !== undefined) sourceSpec.lineMetrics = config.lineMetrics;
    if (config.tolerance !== undefined) sourceSpec.tolerance = config.tolerance;
    if (config.buffer !== undefined) sourceSpec.buffer = config.buffer;
    if (config.maxzoom !== undefined) sourceSpec.maxzoom = config.maxzoom;
    if (config.attribution !== undefined) sourceSpec.attribution = config.attribution;
    // The same for a GeoJSON file, a FlatGeobuf or GeoParquet file decoded
    // into this source, or prefetched data: a file loaded by `url:` is the
    // usual way a student's data arrives (ml-aot.142).
    withFeatureIds(sourceSpec, config, needsIds);

    this.addMapSource(sourceId, sourceSpec);

    this.sourceData.set(sourceId, initialData);
    // This load's generation: a re-target before it lands makes it stale (KTD5).
    const generation = this.nextGeneration(sourceId);

    const load = this.loadGeoJSONSource(sourceId, layerId, config, initialData, generation);
    this.firstLoads.set(sourceId, load.then(() => undefined, () => undefined));
    if (awaitData) {
      await load;
      return;
    }
    void load.catch((error: unknown) => {
      // A reader that failed to start, after the layer was placed: the
      // source's failure, reported as a failed load is (KTD11).
      if (!this.isCurrent(sourceId, generation)) return;
      this.failed.add(sourceId);
      this.callbacks.onDataError?.(layerId, error instanceof Error ? error : new Error(String(error)));
    });
  }

  /** The read behind {@link addGeoJSONSourceFromURL}: a fetch's failure is reported, a reader's thrown. */
  private async loadGeoJSONSource(
    sourceId: string,
    layerId: string,
    config: GeoJSONSourceConfig,
    initialData: FeatureCollection,
    generation: number
  ): Promise<void> {
    // Cloud-native vector data (ml-cnv): a FlatGeobuf or GeoParquet file is
    // decoded into this GeoJSON source by its own data provider instead of
    // the JSON fetch below.
    const format = config.url && !config.prefetchedData ? formatOfSource(config) : undefined;
    if (format === "flatgeobuf") {
      await this.startFlatGeobuf(sourceId, layerId, config);
      return;
    }
    if (format === "geoparquet" && typeReadsFormat(config.type, format)) {
      await this.startGeoParquet(sourceId, layerId, config);
      return;
    }

    // Fetch from URL if needed
    if (config.url && !config.prefetchedData) {
      this.callbacks.onDataLoading?.(layerId);

      try {
        // A load the host already started (the `fitTo` prefetch, ml-aot.75)
        // is awaited, not repeated: one request for the data, ever.
        const pending = this.pendingData.get(sourceId);
        this.pendingData.delete(sourceId);
        const data = await (pending ??
          loadSourceData(config as typeof config & { url: string }, { fetcher: this.dataFetcher }));
        if (!this.isCurrent(sourceId, generation)) return;
        this.sourceData.set(sourceId, data);
        this.failed.delete(sourceId);

        const source = this.map.getSource(sourceId) as GeoJSONSource;
        if (source?.setData) {
          // setData's promise (maplibre-gl 6) never rejects: a worker failure fires the map's `error` event.
          void source.setData(data);
        }

        this.callbacks.onDataLoaded?.(layerId, data.features.length);
      } catch (error: any) {
        if (!this.isCurrent(sourceId, generation)) return;
        this.failed.add(sourceId);
        this.callbacks.onDataError?.(layerId, error);
      }
    } else if (config.prefetchedData) {
      // Emit loaded event for prefetched data
      this.callbacks.onDataLoaded?.(layerId, initialData.features.length);
    }
  }

  /**
   * Read a FlatGeobuf `url:` into its GeoJSON source (ml-cnv.3): the whole
   * file, or — `load: viewport`, or a file too large to load whole — the
   * features in view, re-read as the map moves. Data and error events fire
   * exactly as for a GeoJSON `url:` (after each re-read in viewport mode).
   */
  private async startFlatGeobuf(
    sourceId: string,
    layerId: string,
    config: GeoJSONSourceConfig,
    suspended = false
  ): Promise<void> {
    const load = loadModeOf(config as unknown as Record<string, unknown>);
    // A whole-file load the host already started (the `fitTo` prefetch,
    // ml-aot.75) is reused, not repeated; viewport reads ignore it.
    const pending = this.pendingData.get(sourceId);
    this.pendingData.delete(sourceId);
    const mark = this.releaseMark(sourceId);
    const ready = this.readersFor("flatgeobuf", sourceId, layerId, () =>
      !pending && load.mode === "all" ? startFlatGeobufOpen(config.url!) : undefined
    );
    const got = "then" in ready ? await ready : ready;
    if (!got) return;
    const { readers, opening } = got;
    const loader = new readers.FlatGeobufLoader(this.map, config.url!, load, this.readerCallbacks(sourceId, layerId, config.url!));
    this.formatLoaders.set(sourceId, loader);
    if (suspended || this.paused || this.undrawnSince(sourceId, mark)) loader.suspend();
    await loader.start(pending, opening);
  }

  /**
   * Whether a named source's last layer went while its reader chunk
   * downloaded and nothing draws it yet again: the release suspended no
   * reader (there was none yet), so the new one starts suspended, as
   * `releaseNow` would have left it; a layer drawing it again resumes it.
   */
  private undrawnSince(sourceId: string, mark: number): boolean {
    return this.releasedSince(sourceId, mark) && this.sourceRefCount(sourceId) === 0;
  }

  /**
   * The reader chunk for a FlatGeobuf or GeoParquet source: the old reader
   * destroyed and the source's data loading reported first, as before the
   * providers moved into their chunks (bundle headroom, U5). A chunk already
   * loaded is returned at once — the reader starts in the same turn, as it
   * did — and one still downloading through {@link awaitReaders}.
   *
   * @param open - Starts the file's first request, when the read begins
   *   with one, for the wait (see {@link awaitReaders}).
   */
  private readersFor<F extends ReaderFormat, Opening extends StartedOpen | StartedTail>(
    format: F,
    sourceId: string,
    layerId: string,
    open: () => Opening | undefined
  ):
    | { readers: Decoders[F]; opening: Opening | undefined }
    | Promise<{ readers: Decoders[F]; opening: Opening | undefined } | undefined> {
    this.formatLoaders.get(sourceId)?.destroy();
    this.formatLoaders.delete(sourceId);
    this.callbacks.onDataLoading?.(layerId);
    const loaded = loadedCloudReaders(format);
    return loaded ? { readers: loaded, opening: undefined } : this.awaitReaders(format, sourceId, layerId, open);
  }

  /**
   * Wait for a reader chunk still downloading. Meanwhile the file's first
   * request (`open`) is already on its way, so the two downloads overlap.
   *
   * @returns `undefined` — nothing to start — when this manager was
   *   destroyed, or the source removed, replaced or re-read, while the chunk
   *   downloaded (the first request is then cancelled), or when the download
   *   failed: the source's data error is then the seam's plain notice (KTD8),
   *   and `reload()` retries it through the seam's `?retry=` path.
   */
  private async awaitReaders<F extends ReaderFormat, Opening extends StartedOpen | StartedTail>(
    format: F,
    sourceId: string,
    layerId: string,
    open: () => Opening | undefined
  ): Promise<{ readers: Decoders[F]; opening: Opening | undefined } | undefined> {
    // This load's callbacks (and generation): a load replaced meanwhile reports nothing.
    const callbacks = this.readerCallbacks(sourceId, layerId);
    const generation = this.sourceGenerations.get(sourceId) ?? 0;
    const moved = () => this.destroyed || !this.isCurrent(sourceId, generation);
    const opening = open();
    try {
      const readers = await cloudReaders(format);
      if (!moved()) return { readers, opening };
    } catch (error) {
      if (!moved()) callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
    if (opening) abandonStarted(opening);
    return undefined;
  }

  /**
   * Read a GeoParquet `url:` into its GeoJSON source (ml-cnv.4): the
   * columns the document reads (an author's `columns:` wins), the whole file
   * or — `load: viewport`, or a file too large to load whole — the rows in
   * view, re-read as the map moves. Events fire as for a GeoJSON `url:`.
   */
  private async startGeoParquet(
    sourceId: string,
    layerId: string,
    config: GeoJSONSourceConfig,
    suspended = false
  ): Promise<void> {
    const load = loadModeOf(config as unknown as Record<string, unknown>);
    const pending = this.pendingData.get(sourceId);
    this.pendingData.delete(sourceId);
    const mark = this.releaseMark(sourceId);
    // Both reads (whole, by view) begin with the footer.
    const ready = this.readersFor("geoparquet", sourceId, layerId, () =>
      pending && load.mode === "all" ? undefined : startGeoParquetTail(config.url!, sizeLimits(undefined, load).max)
    );
    const got = "then" in ready ? await ready : ready;
    if (!got) return;
    const { readers, opening } = got;
    const columns = declaredColumns(config) ?? this.columnsFor(sourceId) ?? "all";
    const loader = new readers.GeoParquetLoader(this.map, config.url!, load, columns, this.readerCallbacks(sourceId, layerId, config.url!));
    this.formatLoaders.set(sourceId, loader);
    if (suspended || this.paused || this.undrawnSince(sourceId, mark)) loader.suspend();
    await loader.start(pending, opening);
  }

  /**
   * A cloud-native reader's callbacks for its source: data and errors under
   * the source's current generation (a reader replaced meanwhile delivers
   * nothing, KTD5), author hints and "too dense" reports.
   */
  private readerCallbacks(sourceId: string, layerId: string, url = ""): FlatGeobufCallbacks {
    const generation = this.sourceGenerations.get(sourceId) ?? 0;
    return {
      onData: (data) => {
        if (!this.isCurrent(sourceId, generation)) return;
        this.sourceData.set(sourceId, data);
        this.failed.delete(sourceId);
        const source = this.map.getSource(sourceId) as GeoJSONSource | undefined;
        // setData's promise (maplibre-gl 6) never rejects: a worker failure fires the map's `error` event.
        void source?.setData?.(data);
        this.callbacks.onDataLoaded?.(layerId, data.features.length);
      },
      onError: (error) => {
        if (!this.isCurrent(sourceId, generation)) return;
        this.failed.add(sourceId);
        this.callbacks.onDataError?.(layerId, error);
      },
      // A `once` hint is shown once per source and file, across the readers a
      // live update recreates (KTD14); another file (a `url:` change) hints anew.
      onHint: (message, once) => {
        if (once && !this.firstHint(`\0${sourceId}\0${url}\0${once}`)) return;
        this.callbacks.onSourceHint?.(sourceId, message);
      },
      onTooDense: (dense) => this.callbacks.onViewTooDense?.(sourceId, dense),
      // Another overview level: its feature ids are another level's (U2, KTD5).
      onLevelChange: () => {
        if (this.isCurrent(sourceId, generation)) this.map.removeFeatureState?.({ source: sourceId });
      },
    };
  }

  /**
   * The full extent of a source read by view (`load: viewport`), from the
   * file's header or metadata — what `fitTo` frames, since the source's data
   * is only the part in view. Undefined for every other source.
   */
  getSourceExtent(sourceId: string): [[number, number], [number, number]] | undefined {
    const loader = this.formatLoaders.get(sourceId);
    return loader?.readsByView ? loader.extent : undefined;
  }

  /**
   * The zoom below which a source read by view reads nothing (its
   * `load: { minzoom }`), so `fitTo` doesn't frame it where nothing draws.
   * Undefined for every other source.
   */
  getViewMinzoom(sourceId: string): number | undefined {
    const loader = this.formatLoaders.get(sourceId);
    return loader?.readsByView ? loader.minzoom : undefined;
  }

  /**
   * The outermost zoom, from `from` in, at which a source read by view
   * reads a `width` × `height` px view around `center` (see
   * `FormatLoader.zoomThatFits`); undefined for any other source, or none.
   */
  getViewZoomThatFits(
    sourceId: string,
    center: [number, number],
    from: number,
    width: number,
    height: number
  ): number | undefined {
    const loader = this.formatLoaders.get(sourceId);
    return loader?.readsByView ? loader.zoomThatFits?.(center, from, width, height) : undefined;
  }

  /**
   * Whether a source holds only the features in view: a FlatGeobuf or
   * GeoParquet source read by view — `load: viewport`, or a file too large to read whole that
   * switched itself to it. Its data is never the whole dataset.
   */
  readsByView(sourceId: string): boolean {
    return this.formatLoaders.get(sourceId)?.readsByView ?? false;
  }

  /**
   * Whole columns of a source read by view, for computed classify breaks
   * (0.10 U3): a GeoParquet source's canonical rows, from the file its
   * reader opened; undefined when its reader can't (FlatGeobuf) or it isn't
   * read by view.
   */
  wholeColumns(sourceId: string, names: readonly string[]): Promise<FeatureCollection> | undefined {
    const loader = this.formatLoaders.get(sourceId);
    if (!loader?.readsByView || !loader.readColumns) return undefined;
    // One read per reader and column set: every classified layer over the
    // source shares it (a column can be 32 MB). A new reader reads anew.
    let scans = this.columnScans.get(loader);
    if (!scans) this.columnScans.set(loader, (scans = new Map()));
    const key = [...names].sort().join("\0");
    let scan = scans.get(key);
    if (!scan) scans.set(key, (scan = loader.readColumns(names)));
    return scan;
  }

  /**
   * The identity of a source's current reader: a new one each time a live
   * update (a changed `url:`, a reload) recreates it, so classify knows a
   * whole-column scan of the old reader's file no longer stands.
   */
  readerToken(sourceId: string): object | undefined {
    return this.formatLoaders.get(sourceId);
  }

  /** Whether a source's data comes from a cloud-native reader (no live refresh in 0.9). */
  private isFormatSource(config: GeoJSONSourceConfig): boolean {
    const format = formatOfSource(config);
    return format === "flatgeobuf" || format === "geoparquet";
  }

  /**
   * Setup polling and/or streaming for a GeoJSON source
   */
  private async setupDataUpdates(
    layerId: string,
    sourceId: string,
    config: GeoJSONSourceConfig
  ): Promise<void> {
    // Validation rejects live data on a FlatGeobuf or GeoParquet source in
    // 0.9; a document that skipped validation must not poll a binary file
    // with the JSON fetcher.
    if (this.isFormatSource(config)) {
      console.warn(
        `[maplibre-yaml] live refresh isn't available for FlatGeobuf or GeoParquet sources yet; ` +
          `\`refresh:\`/\`stream:\` on "${sourceId}" is ignored.`
      );
      return;
    }
    if (!config.stream && !(intervalOf(config) && config.url)) return;
    // The first data is on the map: what keeps it current is the `live`
    // chunk (prefetched when the source was added). Awaited once here, so a
    // failed download is reported once for both the stream and the poll.
    if (!(this.live ?? (await this.loadLive(layerId, sourceId)))) return;
    if (config.stream) await this.startStream(layerId, sourceId, config);
    if (intervalOf(config) && config.url) await this.startPolling(layerId, sourceId, config);
  }

  /**
   * The live-data managers, downloading the `live` chunk on first use
   * (bundle headroom, KTD6). `undefined` — nothing to start — when this
   * manager was destroyed, or the source removed, replaced or (a named
   * source) left undrawn, while the chunk downloaded, or when the download
   * failed (KTD8): the source keeps its
   * first data, one notice says its updates stopped, and `reload()` retries
   * it through the seam's `?retry=` path.
   *
   * @param layerId - The pipeline's key, which its data events name.
   */
  private async loadLive(layerId: string, sourceId: string): Promise<LiveData | undefined> {
    // What the source is now: a re-target, replacement or removal during the
    // wait records another spec (or none), and that call starts its own.
    const spec = this.sourceSpecs.get(sourceId);
    // A named source whose last layer went meanwhile: that release found
    // nothing running to stop, and a layer drawing it again starts its own.
    const mark = this.releaseMark(sourceId);
    const moved = () => this.destroyed || this.sourceSpecs.get(sourceId) !== spec || this.releasedSince(sourceId, mark);
    let library: LiveModule;
    try {
      library = await getDecoder("live");
      // A chunk from another version (chunk names carry no version): the
      // same notice as one that didn't download.
      if (typeof library.PollingManager !== "function" || typeof library.StreamManager !== "function" || typeof library.DataMerger !== "function") {
        throw foreignChunk("live");
      }
    } catch (error) {
      if (moved()) return undefined;
      // A named source's first load may still be on its way: report after
      // it, or its data landing would take the line off the notice.
      await this.firstLoads.get(sourceId);
      if (moved()) return undefined;
      // Nothing runs for it: not a refreshing named source.
      this.activeSourcePipelines.delete(sourceId);
      // Once per attempt: a source that streams and polls is one notice.
      if (this.liveUnavailable.has(sourceId)) return undefined;
      this.liveUnavailable.add(sourceId);
      // A FormatError (code "chunk") worded for live updates: the first
      // data stays, so the notice says updates stopped, not "no data". One
      // line, about the first layer drawing the source: the layer the
      // updates' own `data-loaded` names once a retry starts them, which
      // takes the line off the notice.
      const [target = layerId] = this.layersForPipeline(sourceId, layerId);
      this.callbacks.onDataError?.(target, error instanceof Error ? error : new Error(String(error)));
      return undefined;
    }
    if (moved()) return undefined;
    this.live ??= {
      polling: new library.PollingManager(),
      streams: new library.StreamManager(),
      merger: new library.DataMerger(),
      mergeKeyOf: library.mergeKeyOf,
    };
    return this.live;
  }

  /** Connect a source's `stream:` under `layerId` (the pipeline key; see `pipelineOwner`). */
  private async startStream(layerId: string, sourceId: string, config: GeoJSONSourceConfig): Promise<void> {
    const live = this.live ?? (await this.loadLive(layerId, sourceId));
    if (!live) return;
    // `pause()` ran while the chunk downloaded: no new connection while the
    // next map loads its own; `resume()` connects it.
    if (this.paused) {
      this.pausedStreams.set(layerId, { sourceId, config });
      return;
    }
    const streamConfig = config.stream!;
    const merge = mergeOptionsOf(config);
    // A first connection that fails is reported through onError and retried
    // by the stream (ml-7qa.12): the layer and its data stay.
    await live.streams.connect(layerId, {
      type: streamConfig.type,
      url: streamConfig.url || config.url!,
      onData: (data) => {
        this.handleDataUpdate(sourceId, layerId, data, merge);
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
    }).catch(() => {});
  }

  /**
   * Poll a source's `url:` under `layerId` (the pipeline key; see
   * `pipelineOwner`). `immediate` fetches at once as well as on the schedule.
   */
  private async startPolling(layerId: string, sourceId: string, config: GeoJSONSourceConfig, immediate = false): Promise<void> {
    const live = this.live ?? (await this.loadLive(layerId, sourceId));
    if (!live) return;
    const url = config.url!;
    const cacheEnabled = config.cache?.enabled ?? true;
    const cacheTTL = config.cache?.ttl;
    const merge = mergeOptionsOf(config);

    live.polling.start(layerId, {
      interval: intervalOf(config)!,
      // Started while the map is paused (a fallback rebuild, KTD8): no tick now.
      immediate: immediate && !this.paused,
      onTick: async () => {
        // A tick that started before the source was re-targeted lands on
        // data it no longer belongs to: dropped (KTD5).
        const generation = this.sourceGenerations.get(sourceId) ?? 0;
        // A tick asks the server what changed: never answer it from the
        // cache. The cache's TTL (5 minutes by default) is longer than
        // most refresh intervals, so reading through it served the first
        // response again until it expired (ml-ahu). `revalidate` still
        // writes the new response, so other readers of the cache are
        // current too.
        const result = await this.dataFetcher.fetch(url, {
          skipCache: !cacheEnabled,
          revalidate: true,
          ttl: cacheTTL,
        });
        if (!this.isCurrent(sourceId, generation)) return;
        this.handleDataUpdate(sourceId, layerId, result.data as FeatureCollection, merge);
      },
      onError: (error) => {
        this.failed.add(sourceId);
        this.callbacks.onDataError?.(layerId, error);
      },
    });
    // `pause()` ran while the chunk downloaded: it starts paused, as the
    // polls already running were, and `resume()` lets it go.
    if (this.paused) live.polling.pause(layerId);
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
    // Before the first update: what the source started from (an inline
    // `data:` collection never passes through `sourceData`, ml-7qa.12).
    const inline = this.sourceSpecs.get(sourceId)?.data as FeatureCollection | undefined;
    const existing =
      this.sourceData.get(sourceId) ??
      (Array.isArray(inline?.features) ? inline : emptyCollection());

    // Only a running pipeline delivers updates, so the `live` chunk is in
    // (none after `destroy()`).
    const live = this.live;
    if (!live) return;
    const mergeResult = live.merger.merge(existing, incoming, options);
    this.sourceData.set(sourceId, mergeResult.data);
    this.failed.delete(sourceId);
    if (mergeResult.unkeyed && options.updateKey) {
      this.warnKeyless(sourceId, incoming, options.updateKey, mergeResult.unkeyed, live.mergeKeyOf);
    }

    const source = this.map.getSource(sourceId) as GeoJSONSource;
    if (source?.setData) {
      // setData's promise (maplibre-gl 6) never rejects: a worker failure fires the map's `error` event.
      void source.setData(mergeResult.data);
    }

    // One pipeline can back several layers. Fire per referencing layer so a
    // consumer listening on its own layer sees what it always did.
    for (const target of this.layersForPipeline(sourceId, layerId)) {
      this.callbacks.onDataLoaded?.(target, mergeResult.total);
    }
  }

  /**
   * Say, once per source, that a `merge` update carried features with no
   * key: they are kept rather than matched, which is rarely what the author
   * meant (ml-aot.141). Names the key and some properties the data does have,
   * since a misspelt or wrongly placed key is the usual cause.
   */
  private warnKeyless(
    sourceId: string,
    incoming: FeatureCollection,
    updateKey: string,
    count: number,
    keyOf: LiveModule["mergeKeyOf"]
  ): void {
    if (this.keylessWarned.has(sourceId)) return;
    this.keylessWarned.add(sourceId);
    const sample = incoming.features.find((f) => keyOf(f, updateKey) === undefined);
    const names = Object.keys(sample?.properties ?? {}).slice(0, 6);
    const has = names.length
      ? ` Its features have properties such as ${names.map((n) => `\`${n}\``).join(", ")}.`
      : " Its features have no properties.";
    this.callbacks.onSourceHint?.(
      sourceId,
      `Source \`${sourceId}\`: ${count} of ${incoming.features.length} updated features have no \`${updateKey}\` ` +
        `property and no top-level \`id\`, so \`updateStrategy: merge\` can't match them; ` +
        `they are kept as they are, replaced by each update's own.${has}` +
        ` Set \`updateKey\` to a property that is different for every feature.`
    );
  }

  /**
   * Which layers a pipeline's events belong to.
   *
   * @remarks
   * For an inline source that is just the owning layer. For a named source it
   * is every layer drawing from it, so siblings are not left unaware that the
   * data underneath them changed.
   */
  private layersForPipeline(sourceId: string, fallbackLayerId: string): string[] {
    const referencing = [...this.layerToSource.entries()]
      .filter(([, id]) => id === sourceId)
      .map(([layerId]) => layerId);
    return referencing.length > 0 ? referencing : [fallbackLayerId];
  }

  /**
   * Stop every pipeline — polling and the by-view loaders — because the map
   * is being replaced by a fallback rebuild (KTD8): no second set of fetches
   * while the next map loads its own. Not resumed; the map is torn down.
   */
  pause(): void {
    this.paused = true;
    this.live?.polling.pauseAll();
    for (const loader of this.formatLoaders.values()) loader.suspend?.();
  }

  /** The counterpart of {@link pause}: the rebuild failed and this map stays. */
  resume(): void {
    this.paused = false;
    this.live?.polling.resumeAll();
    for (const loader of this.formatLoaders.values()) loader.resume?.();
    const waiting = [...this.pausedStreams];
    this.pausedStreams.clear();
    for (const [key, { sourceId, config }] of waiting) {
      void this.startStream(key, sourceId, config).catch((error: unknown) =>
        this.callbacks.onDataError?.(key, error instanceof Error ? error : new Error(String(error)))
      );
    }
  }

  /**
   * Pause data refresh for a layer (polling)
   */
  pauseRefresh(layerId: string): void {
    this.live?.polling.pause(this.pipelineKeyFor(layerId));
  }

  /**
   * Resume data refresh for a layer (polling)
   */
  resumeRefresh(layerId: string): void {
    this.live?.polling.resume(this.pipelineKeyFor(layerId));
  }

  /**
   * Force immediate refresh for a layer (polling)
   *
   * @throws when the layer has no poll running (as `PollingManager.triggerNow` does).
   */
  async refreshNow(layerId: string): Promise<void> {
    const key = this.pipelineKeyFor(layerId);
    if (!this.live) throw new Error(`Polling subscription "${key}" not found`);
    await this.live.polling.triggerNow(key);
  }

  /**
   * The key a layer's refresh pipeline runs under.
   *
   * @remarks
   * Inline sources run per layer; named sources run once per source id and are
   * shared. The public API stays layer-keyed either way, so callers never have
   * to know which shape they configured.
   */
  private pipelineKeyFor(layerId: string): string {
    const sourceId = this.layerToSource.get(layerId);
    return sourceId && this.activeSourcePipelines.has(sourceId)
      ? sourceId
      : layerId;
  }

  /**
   * Disconnect streaming connection for a layer
   */
  disconnectStream(layerId: string): void {
    this.dropStream(this.pipelineKeyFor(layerId));
  }

  removeLayer(layerId: string): void {
    this.claimedLayerIds.delete(layerId);
    this.parkedAnchors.delete(layerId);
    // Stop all data updates
    this.live?.polling.stop(layerId);
    this.dropStream(layerId);

    if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);

    const sourceId = this.layerToSource.get(layerId) || `${layerId}-source`;

    // Only remove the source if it was created inline for this layer (not a shared named source).
    // A shared named source's ID won't match the "${layerId}-source" pattern.
    const isInlineSource = sourceId === `${layerId}-source`;
    if (isInlineSource && this.map.getSource(sourceId)) {
      this.map.removeSource(sourceId);
    }

    // Drop this layer's claim before releasing, so the refcount reflects
    // reality when releaseSource decides whether the pipeline is still needed.
    this.layerToSource.delete(layerId);

    if (isInlineSource) {
      this.forgetSource(sourceId);
    } else if (this.sourceRefCounts.has(sourceId)) {
      // Shared: the data stays as long as a sibling still draws from it.
      this.releaseSource(sourceId);
    }
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
    // Resolve through the layer→source map rather than assuming the derived
    // `<layerId>-source` id: a layer over a named source has no such source,
    // so the update used to silently do nothing. Updating a shared source is
    // visible to every layer over it — documented, not accidental.
    const sourceId = this.layerToSource.get(layerId) ?? `${layerId}-source`;
    const source = this.map.getSource(sourceId) as GeoJSONSource;
    // setData's promise (maplibre-gl 6) never rejects: a worker failure fires the map's `error` event.
    if (source && source.setData) void source.setData(data as any);
  }

  destroy(): void {
    // Clean up all data management components (a live chunk still
    // downloading starts nothing: `destroyed`).
    this.destroyed = true;
    this.pausedStreams.clear();
    this.live?.polling.destroy();
    this.live?.streams.destroy();
    this.live = null;
    for (const loader of this.formatLoaders.values()) loader.destroy();
    this.formatLoaders.clear();

    // Clear data references
    this.sourceData.clear();
    this.layerToSource.clear();
    this.claimedLayerIds.clear();
    this.pendingReleases = null;
    this.hintedAnchors.clear();
    this.sourceSpecs.clear();
    this.sourceGenerations.clear();
    this.sourceReleases.clear();
    this.failed.clear();
    this.liveUnavailable.clear();
    this.firstLoads.clear();
    this.parkedAnchors.clear();
  }
}
