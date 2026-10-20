/**
 * @file Loading a named source's whole data as GeoJSON — the seam the
 * `fitTo` prefetch and the layer manager share (ml-aot.75)
 * @module @maplibre-yaml/core/data/source-data
 *
 * @description
 * A `type: geojson` source with a `url:` is loaded by the library, not by
 * MapLibre: the data arrives as a FeatureCollection, is handed to the
 * MapLibre source with `setData`, and is what `fitTo` frames. Two callers
 * start that load:
 *
 * - `<ml-map>`, ahead of the map, when `fitTo` names the source: it fetches
 *   the data in parallel with page start-up and builds the map already
 *   framed on it (no camera jump on load);
 * - the layer manager, when the map registers the source (or reuses the
 *   load `<ml-map>` already started — one request, never two).
 *
 * Both go through {@link loadSourceData}. A format that decodes to GeoJSON
 * (FlatGeobuf, GeoParquet — the cloud-native formats design, D2) plugs in
 * with {@link registerSourceDataLoader} and gets the prefetch-and-frame path
 * for free. Internal: not exported from the package entry points.
 */

import type { FeatureCollection } from "geojson";
import type { DataFetcher } from "./data-fetcher";

/** What a loader gets besides the source. */
export interface SourceDataContext {
  /** The fetcher (and cache) of the map the data is for. */
  fetcher: DataFetcher;
}

/**
 * A loader for a source format: returns the load when the source is its
 * format, `undefined` otherwise (the next loader, then plain GeoJSON, is
 * tried).
 */
export type SourceDataLoader = (
  source: Readonly<Record<string, unknown>>,
  context: SourceDataContext
) => Promise<FeatureCollection> | undefined;

const loaders: SourceDataLoader[] = [];

/**
 * Add a loader, tried before plain GeoJSON. Returns a function that removes
 * it again.
 */
export function registerSourceDataLoader(loader: SourceDataLoader): () => void {
  loaders.push(loader);
  return () => {
    const index = loaders.indexOf(loader);
    if (index !== -1) loaders.splice(index, 1);
  };
}

/**
 * Whether a source's data is loaded by the library from a `url:` (so it can
 * be loaded before the map exists): a `geojson` source with a `url` and no
 * inline `data`, no `prefetchedData`, and no `stream:` (a stream connects
 * rather than loads once).
 */
export function isLoadedFromUrl(source: unknown): source is Record<string, unknown> & { url: string } {
  if (!source || typeof source !== "object") return false;
  const s = source as Record<string, unknown>;
  return (
    s["type"] === "geojson" &&
    typeof s["url"] === "string" &&
    s["url"] !== "" &&
    s["data"] === undefined &&
    s["prefetchedData"] === undefined &&
    s["stream"] === undefined
  );
}

/**
 * Load a source's whole data as a FeatureCollection: a registered loader
 * for its format, else a GeoJSON fetch through `context.fetcher`, honouring
 * the source's `cache:` (`enabled: false` skips the cache, `ttl` sets it).
 *
 * @remarks
 * Rejects as the fetch does: the error carries the requested `url`, so the
 * page can say which file did not load.
 */
export function loadSourceData(
  source: Readonly<Record<string, unknown>> & { url: string },
  context: SourceDataContext
): Promise<FeatureCollection> {
  for (const loader of loaders) {
    const load = loader(source, context);
    if (load) return load;
  }
  const cache = source["cache"] as { enabled?: boolean; ttl?: number } | undefined;
  return context.fetcher
    .fetch(source.url, { skipCache: !(cache?.enabled ?? true), ttl: cache?.ttl })
    .then((result) => result.data);
}
