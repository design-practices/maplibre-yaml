/**
 * @file Layer manager for MapLibre map layers
 * @module @maplibre-yaml/core/renderer
 */

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
// Import the constant from its submodule rather than the interactions barrel:
// the barrel now re-exports `attachInteractions`, which eagerly loads the
// maplibre-gl `Popup` value, and this module needs only a maplibre-free string.
import { HOVER_FEATURE_STATE_KEY } from "../interactions/built-ins";
import { DataFetcher } from "../data/data-fetcher";
import { PollingManager } from "../data/polling-manager";
import { StreamManager } from "../data/streaming/stream-manager";
import { DataMerger } from "../data/merge/data-merger";
import { LoadingManager } from "../ui/loading-manager";
import type { MergeStrategy } from "../data/merge/data-merger";

type Layer = z.infer<typeof LayerSchema>;
type GeoJSONSourceConfig = z.infer<typeof GeoJSONSourceSchema>;
type VectorSourceConfig = z.infer<typeof VectorSourceSchema>;
type RasterSourceConfig = z.infer<typeof RasterSourceSchema>;
type RasterDEMSourceConfig = z.infer<typeof RasterDEMSourceSchema>;
type ImageSourceConfig = z.infer<typeof ImageSourceSchema>;
type VideoSourceConfig = z.infer<typeof VideoSourceSchema>;

/**
 * The paint property each layer type highlights through.
 *
 * @remarks
 * Types absent here (heatmap, raster, hillshade, background) have no
 * per-feature color to drive, so highlight does not apply to them.
 */
const HIGHLIGHT_PAINT_PROPERTY: Record<string, string> = {
  circle: "circle-color",
  line: "line-color",
  fill: "fill-color",
  "fill-extrusion": "fill-extrusion-color",
  symbol: "text-color",
};

/**
 * Colour a highlighted feature takes.
 *
 * @remarks
 * `hover.highlight` is a boolean, so the colour cannot be authored. Authors who
 * want control write their own `["feature-state", "hover"]` paint expression
 * instead, which this rewrite deliberately leaves untouched.
 */
const HIGHLIGHT_COLOR = "#ffd700";

/** Whether a layer asks for hover highlighting. */
function isHighlightEnabled(layer: Layer): boolean {
  const interactive = (layer as { interactive?: { hover?: { highlight?: unknown } } })
    .interactive;
  return interactive?.hover?.highlight === true;
}

/**
 * Wrap the layer's primary colour in a feature-state `case`, so a highlighted
 * feature renders differently.
 *
 * @remarks
 * Only rewrites a plain literal colour. An authored expression is left alone
 * and warned about: overwriting it would silently discard data-driven styling,
 * and merging arbitrary expressions is not something we can do correctly.
 */
function applyHighlightPaint(layerSpec: any, layerType: string): void {
  const property = HIGHLIGHT_PAINT_PROPERTY[layerType];
  if (!property) {
    console.warn(
      `[maplibre-yaml] hover.highlight is not supported on "${layerType}" ` +
        "layers — they have no per-feature colour to drive."
    );
    return;
  }

  const paint = (layerSpec.paint ??= {});
  const authored = paint[property];

  if (Array.isArray(authored)) {
    console.warn(
      `[maplibre-yaml] hover.highlight left "${property}" on layer ` +
        `"${layerSpec.id}" untouched because it is already an expression. ` +
        'Reference ["feature-state", "hover"] in that expression to style the ' +
        "highlight yourself."
    );
    return;
  }

  paint[property] = [
    "case",
    ["boolean", ["feature-state", HOVER_FEATURE_STATE_KEY], false],
    HIGHLIGHT_COLOR,
    // MapLibre's default for every colour paint property we highlight through.
    authored ?? "#000000",
  ];
}

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
  private dataFetcher: DataFetcher;
  private pollingManager: PollingManager;
  private streamManager: StreamManager;
  private dataMerger: DataMerger;
  private loadingManager: LoadingManager;
  private sourceData: Map<string, FeatureCollection>;
  private layerToSource: Map<string, string>;
  /** Block-level `sources:` specs, kept for their YAML-only refresh config. */
  private namedSources: Map<string, Record<string, unknown>>;
  /** How many live layers reference each named source. */
  private sourceRefCounts: Map<string, number>;
  /** Named sources with a refresh/stream pipeline currently running. */
  private activeSourcePipelines: Set<string>;

  constructor(map: MapLibreMap, callbacks?: LayerManagerCallbacks) {
    this.map = map;
    this.callbacks = callbacks || {};
    this.dataFetcher = new DataFetcher();
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
      this.map.addSource(id, this.toMapLibreSourceSpec(spec as any));
    }
  }

  /**
   * Strip keys that drive our own machinery rather than MapLibre's.
   *
   * @remarks
   * `refresh`, `cache`, `prefetchedData` and the legacy top-level refresh
   * fields are ours; passing them through leaves unknown keys on the source
   * spec MapLibre validates.
   */
  private toMapLibreSourceSpec(spec: Record<string, unknown>): any {
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
    return mapLibreSpec;
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
    // If source is a string reference (named source), use it directly;
    // otherwise generate a source ID for inline source objects
    const isSourceRef = typeof layer.source === "string";
    const sourceId = isSourceRef ? layer.source as string : `${layer.id}-source`;
    this.layerToSource.set(layer.id, sourceId);

    if (isSourceRef) {
      // One pipeline per source id regardless of how many layers reference it.
      this.sourceRefCounts.set(
        sourceId,
        (this.sourceRefCounts.get(sourceId) ?? 0) + 1
      );
    }

    if (!isSourceRef) {
      await this.addSource(sourceId, layer);
    } else if (!this.map.getSource(sourceId)) {
      throw new Error(
        `Source '${sourceId}' referenced by layer '${layer.id}' not found. ` +
        `Ensure it is defined in the block-level 'sources' map.`
      );
    }

    const layerSpec: any = {
      id: layer.id,
      type: layer.type,
      source: sourceId,
    };

    if ("paint" in layer && layer.paint) layerSpec.paint = layer.paint;

    // `hover.highlight` is only visible if some paint property reads the hover
    // feature-state, so wire it into the layer's primary color here.
    if (isHighlightEnabled(layer)) {
      applyHighlightPaint(layerSpec, layer.type);
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

    this.map.addLayer(layerSpec, layer.before as string | undefined);

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
        await this.addGeoJSONSourceFromURL(sourceId, layer.id, geojsonSource);
      } else if (geojsonSource.data) {
        const sourceSpec: any = {
          type: "geojson",
          data: geojsonSource.data,
        };

        // Authored id strategy first — it always wins over the fallback below.
        if (geojsonSource.generateId !== undefined) sourceSpec.generateId = geojsonSource.generateId;
        if (geojsonSource.promoteId !== undefined) sourceSpec.promoteId = geojsonSource.promoteId;

        // Feature-state is addressed by feature id. Without one, highlight has
        // nothing to target — so opt the source into generated ids rather than
        // leaving the configured highlight silently dead.
        if (
          isHighlightEnabled(layer) &&
          !geojsonSource.generateId &&
          !geojsonSource.promoteId
        ) {
          sourceSpec.generateId = true;
          console.warn(
            `[maplibre-yaml] hover.highlight on layer "${layer.id}" enabled ` +
              "`generateId` on its source, because feature-state needs ids. " +
              "Set `promoteId` if a property should be the id instead — " +
              "generated ids are not stable across data refreshes."
          );
        }

        // Only add clustering properties if they are defined
        if (geojsonSource.cluster !== undefined) sourceSpec.cluster = geojsonSource.cluster;
        if (geojsonSource.clusterRadius !== undefined) sourceSpec.clusterRadius = geojsonSource.clusterRadius;
        if (geojsonSource.clusterMaxZoom !== undefined) sourceSpec.clusterMaxZoom = geojsonSource.clusterMaxZoom;
        if (geojsonSource.clusterMinPoints !== undefined) sourceSpec.clusterMinPoints = geojsonSource.clusterMinPoints;
        if (geojsonSource.clusterProperties !== undefined) sourceSpec.clusterProperties = geojsonSource.clusterProperties;

        this.map.addSource(sourceId, sourceSpec);
      } else if (geojsonSource.stream) {
        this.map.addSource(sourceId, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
    } else if (source.type === "vector") {
      const vectorSource = source as unknown as VectorSourceConfig;
      const vectorSpec: any = { type: "vector" };
      if (vectorSource.url) vectorSpec.url = vectorSource.url;
      if (vectorSource.tiles) vectorSpec.tiles = vectorSource.tiles;
      if (vectorSource.minzoom !== undefined)
        vectorSpec.minzoom = vectorSource.minzoom;
      if (vectorSource.maxzoom !== undefined)
        vectorSpec.maxzoom = vectorSource.maxzoom;
      if (vectorSource.bounds) vectorSpec.bounds = vectorSource.bounds;
      if (vectorSource.attribution)
        vectorSpec.attribution = vectorSource.attribution;
      this.map.addSource(sourceId, vectorSpec);
    } else if (source.type === "raster") {
      const rasterSource = source as unknown as RasterSourceConfig;
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
      this.map.addSource(sourceId, rasterSpec);
    } else if (source.type === "raster-dem") {
      // Forwarded whole rather than field-by-field: the schema is passthrough,
      // and `encoding: custom` is meaningless without the redFactor/
      // greenFactor/blueFactor/baseShift that come with it. A whitelist would
      // drop those silently and leave custom encodings decoding as mapbox.
      // Safe to spread — raster-dem carries no YAML-only keys to scrub (unlike
      // geojson's refresh/cache/prefetchedData). This also matches how
      // block-level named sources reach MapLibre.
      const demSource = source as unknown as RasterDEMSourceConfig;
      this.map.addSource(sourceId, {
        ...demSource,
        type: "raster-dem",
      } as any);
    } else if (source.type === "image") {
      const imageSource = source as unknown as ImageSourceConfig;
      this.map.addSource(sourceId, {
        type: "image",
        url: imageSource.url,
        coordinates: imageSource.coordinates,
      });
    } else if (source.type === "video") {
      const videoSource = source as unknown as VideoSourceConfig;
      this.map.addSource(sourceId, {
        type: "video",
        urls: videoSource.urls,
        coordinates: videoSource.coordinates,
      });
    }
  }

  private async addGeoJSONSourceFromURL(
    sourceId: string,
    layerId: string,
    config: GeoJSONSourceConfig
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

    this.map.addSource(sourceId, sourceSpec);

    this.sourceData.set(sourceId, initialData);

    // Fetch from URL if needed
    if (config.url && !config.prefetchedData) {
      this.callbacks.onDataLoading?.(layerId);

      try {
        const cacheEnabled = config.cache?.enabled ?? true;
        const cacheTTL = config.cache?.ttl;

        const result = await this.dataFetcher.fetch(config.url, {
          skipCache: !cacheEnabled,
          ttl: cacheTTL,
        });

        const data = result.data as FeatureCollection;
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
   * Setup polling and/or streaming for a GeoJSON source
   */
  private async setupDataUpdates(
    layerId: string,
    sourceId: string,
    config: GeoJSONSourceConfig
  ): Promise<void> {
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

    // Clear data references
    this.sourceData.clear();
    this.layerToSource.clear();
  }
}
