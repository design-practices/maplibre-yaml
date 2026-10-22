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
import { PollingManager } from "../data/polling-manager";
import { StreamManager } from "../data/streaming/stream-manager";
import { DataMerger } from "../data/merge/data-merger";
import { LoadingManager } from "../ui/loading-manager";
import { sanitizeAttribution } from "../utils/attribution";
import { mergeKeyOf, type MergeStrategy } from "../data/merge/data-merger";
import { declaredColumns, formatOfSource, typeReadsFormat } from "../formats/detect";
import {
  FlatGeobufLoader,
  GeoParquetLoader,
  loadModeOf,
  toMapLibreTileSpec,
  withoutFormatKeys,
  type FormatLoader,
} from "./cloud-sources";

type Layer = z.infer<typeof LayerSchema>;
type GeoJSONSourceConfig = z.infer<typeof GeoJSONSourceSchema>;
type VectorSourceConfig = z.infer<typeof VectorSourceSchema>;
type RasterSourceConfig = z.infer<typeof RasterSourceSchema>;
type RasterDEMSourceConfig = z.infer<typeof RasterDEMSourceSchema>;
type ImageSourceConfig = z.infer<typeof ImageSourceSchema>;
type VideoSourceConfig = z.infer<typeof VideoSourceSchema>;

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
  private pollingManager: PollingManager;
  private streamManager: StreamManager;
  private dataMerger: DataMerger;
  private loadingManager: LoadingManager;
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
  /** First loads a host already started, by source id (consumed once). */
  private pendingData: Map<string, Promise<FeatureCollection>>;
  /** Sources already told their `merge` updates carry keyless features (once each). */
  private keylessWarned = new Set<string>();
  /** FlatGeobuf / GeoParquet readers by source id (ml-cnv.3/.4), stopped with their source. */
  private formatLoaders = new Map<string, FormatLoader>();
  /** Whether the page registered a URL protocol itself (see LayerManagerDataOptions). */
  private isProtocolRegistered: (scheme: string) => boolean;
  /** The GeoParquet columns the document reads (see LayerManagerDataOptions). */
  private columnsFor: (sourceId: string) => readonly string[] | "all" | undefined;
  /** Named sources a highlighted layer draws from (see LayerManagerDataOptions). */
  private namedSourcesNeedingIds: ReadonlySet<string>;

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
    this.pollingManager = new PollingManager();
    this.streamManager = new StreamManager();
    this.dataMerger = new DataMerger();
    this.loadingManager = new LoadingManager({ showUI: false });
    this.sourceData = new Map();
    this.layerToSource = new Map();
    this.namedSources = new Map();
    this.sourceRefCounts = new Map();
    this.activeSourcePipelines = new Set();
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

  /** Stop a named source's pipeline once nothing references it. */
  private releaseSource(sourceId: string): void {
    const remaining = (this.sourceRefCounts.get(sourceId) ?? 1) - 1;

    if (remaining > 0) {
      this.sourceRefCounts.set(sourceId, remaining);
      return; // siblings still need the data
    }

    this.sourceRefCounts.delete(sourceId);
    if (this.activeSourcePipelines.delete(sourceId)) {
      this.pollingManager.stop(sourceId);
      this.streamManager.disconnect(sourceId);
    }
  }

  /** Whether a refresh/stream pipeline is running for a named source. */
  isRefreshing(sourceId: string): boolean {
    return this.activeSourcePipelines.has(sourceId);
  }

  async addLayer(layer: Layer): Promise<void> {
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
      await this.addClaimedLayer(layer);
    } catch (error) {
      // A layer that failed to add holds no id: a later retry is not a repeat.
      this.claimedLayerIds.delete(layer.id);
      throw error;
    }
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
    this.callbacks.onLayerHint?.(
      layer.id,
      `Layer \`${layer.id}\`: \`before: ${before}\` names no layer on this map, so the layer is drawn on top instead.` +
        (near ? ` Did you mean \`${near}\`?` : "")
    );
    return undefined;
  }

  private async addClaimedLayer(layer: Layer): Promise<void> {
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
        this.sourceRefCounts.set(
          sourceId,
          (this.sourceRefCounts.get(sourceId) ?? 0) + 1
        );
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
        await this.addSource(sourceId, layer);
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

    this.map.addLayer(layerSpec, this.beforeOrTop(layer));

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

  private async addSource(sourceId: string, layer: Layer): Promise<void> {
    // layer.source is guaranteed to be an object (string refs handled in addLayer)
    const source = layer.source as { type: string };

    if (source.type === "geojson") {
      const geojsonSource = source as unknown as GeoJSONSourceConfig;

      if (geojsonSource.url) {
        await this.addGeoJSONSourceFromURL(
          sourceId,
          layer.id,
          geojsonSource,
          isHighlightEnabled(layer)
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

  private async addGeoJSONSourceFromURL(
    sourceId: string,
    layerId: string,
    config: GeoJSONSourceConfig,
    needsIds = false
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
   * Read a FlatGeobuf `url:` into its GeoJSON source (ml-cnv.3): the whole
   * file, or — `load: viewport`, or a file too large to load whole — the
   * features in view, re-read as the map moves. Data and error events fire
   * exactly as for a GeoJSON `url:` (after each re-read in viewport mode).
   */
  private async startFlatGeobuf(
    sourceId: string,
    layerId: string,
    config: GeoJSONSourceConfig
  ): Promise<void> {
    this.formatLoaders.get(sourceId)?.destroy();
    this.callbacks.onDataLoading?.(layerId);
    const loader = new FlatGeobufLoader(
      this.map,
      config.url!,
      loadModeOf(config as unknown as Record<string, unknown>),
      {
        onData: (data) => {
          this.sourceData.set(sourceId, data);
          const source = this.map.getSource(sourceId) as GeoJSONSource | undefined;
          source?.setData?.(data);
          this.callbacks.onDataLoaded?.(layerId, data.features.length);
        },
        onError: (error) => this.callbacks.onDataError?.(layerId, error),
      }
    );
    this.formatLoaders.set(sourceId, loader);
    // A whole-file load the host already started (the `fitTo` prefetch,
    // ml-aot.75) is reused, not repeated; viewport reads ignore it.
    const pending = this.pendingData.get(sourceId);
    this.pendingData.delete(sourceId);
    await loader.start(pending);
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
    config: GeoJSONSourceConfig
  ): Promise<void> {
    this.formatLoaders.get(sourceId)?.destroy();
    this.callbacks.onDataLoading?.(layerId);
    const columns = declaredColumns(config) ?? this.columnsFor(sourceId) ?? "all";
    const loader = new GeoParquetLoader(
      this.map,
      config.url!,
      loadModeOf(config as unknown as Record<string, unknown>),
      columns,
      {
        onData: (data) => {
          this.sourceData.set(sourceId, data);
          const source = this.map.getSource(sourceId) as GeoJSONSource | undefined;
          source?.setData?.(data);
          this.callbacks.onDataLoaded?.(layerId, data.features.length);
        },
        onError: (error) => this.callbacks.onDataError?.(layerId, error),
      }
    );
    this.formatLoaders.set(sourceId, loader);
    const pending = this.pendingData.get(sourceId);
    this.pendingData.delete(sourceId);
    await loader.start(pending);
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
   * Whether a source holds only the features in view: a FlatGeobuf or
   * GeoParquet source read by view — `load: viewport`, or a file too large to read whole that
   * switched itself to it. Its data is never the whole dataset.
   */
  readsByView(sourceId: string): boolean {
    return this.formatLoaders.get(sourceId)?.readsByView ?? false;
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
    if (mergeResult.unkeyed && options.updateKey) {
      this.warnKeyless(sourceId, incoming, options.updateKey, mergeResult.unkeyed);
    }

    const source = this.map.getSource(sourceId) as GeoJSONSource;
    if (source?.setData) {
      source.setData(mergeResult.data);
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
    count: number
  ): void {
    if (this.keylessWarned.has(sourceId)) return;
    this.keylessWarned.add(sourceId);
    const sample = incoming.features.find((f) => mergeKeyOf(f, updateKey) === undefined);
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
   * Pause data refresh for a layer (polling)
   */
  pauseRefresh(layerId: string): void {
    this.pollingManager.pause(this.pipelineKeyFor(layerId));
  }

  /**
   * Resume data refresh for a layer (polling)
   */
  resumeRefresh(layerId: string): void {
    this.pollingManager.resume(this.pipelineKeyFor(layerId));
  }

  /**
   * Force immediate refresh for a layer (polling)
   */
  async refreshNow(layerId: string): Promise<void> {
    await this.pollingManager.triggerNow(this.pipelineKeyFor(layerId));
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
    this.streamManager.disconnect(this.pipelineKeyFor(layerId));
  }

  removeLayer(layerId: string): void {
    this.claimedLayerIds.delete(layerId);
    // Stop all data updates
    this.pollingManager.stop(layerId);
    this.streamManager.disconnect(layerId);
    this.loadingManager.hideLoading(layerId);

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
      this.sourceData.delete(sourceId);
      this.formatLoaders.get(sourceId)?.destroy();
      this.formatLoaders.delete(sourceId);
    } else {
      // Shared: the data stays as long as a sibling still draws from it.
      this.releaseSource(sourceId);
      if (!this.sourceRefCounts.has(sourceId)) this.sourceData.delete(sourceId);
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
    if (source && source.setData) source.setData(data as any);
  }

  destroy(): void {
    // Clean up all data management components
    this.pollingManager.destroy();
    this.streamManager.destroy();
    this.loadingManager.destroy();
    for (const loader of this.formatLoaders.values()) loader.destroy();
    this.formatLoaders.clear();

    // Clear data references
    this.sourceData.clear();
    this.layerToSource.clear();
    this.claimedLayerIds.clear();
  }
}
