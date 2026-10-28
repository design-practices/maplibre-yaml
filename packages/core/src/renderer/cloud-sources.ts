/**
 * @file Cloud-native sources at render time: protocols, URLs, and the hand-off to the readers (0.9, ml-cnv; bundle headroom U5)
 * @module @maplibre-yaml/core/renderer/cloud-sources
 *
 * @description
 * What the renderer does with a source whose URL names a cloud-native file
 * (see `formats/detect.ts` for the authoring rule):
 *
 * - **PMTiles** (`vector` / `raster` / `raster-dem`): the `pmtiles://`
 *   protocol is registered once on the renderer's maplibre-gl module
 *   (`prepareProtocols` in ./cloud-protocols, host wins), and the source URL is rewritten to
 *   the canonical `pmtiles://<absolute URL>` ({@link toMapLibreTileSpec}) —
 *   absolute so the protocol's per-archive cache has one key per file and the
 *   request works wherever MapLibre issues it.
 * - **FlatGeobuf** and **GeoParquet** (`geojson`): decoded into the
 *   source's GeoJSON by a data provider (`FlatGeobufLoader`,
 *   `GeoParquetLoader`) the GeoJSON `url:` pipeline calls instead of its JSON
 *   fetch — so `fitTo`, data events, popups and the legend see ordinary
 *   GeoJSON. The providers, the adapters and the libraries are the
 *   `flatgeobuf` and `geoparquet` on-demand chunks (formats/lib/); this
 *   module loads them ({@link cloudReaders}), hands them the {@link CloudHost}
 *   they use core through, and starts each file's first request while its
 *   chunk downloads, so the two overlap ({@link startFlatGeobufOpen},
 *   {@link startGeoParquetTail}).
 * - **COG** (`raster` / `raster-dem`): like PMTiles, a `cog://` protocol
 *   (registered by `prepareProtocols`, its reader fetched on demand); the
 *   URL becomes `cog://<absolute URL>` plus `#dem` or the `colorRamp:`
 *   colours, with `tileSize: 256` (`formats/cog-spec`).
 */

import type { FeatureCollection } from "geojson";
import {
  formatOfSource,
  loadModeOf,
  stripScheme,
  typeReadsFormat,
  type CloudFormat,
  type LoadMode,
} from "../formats/detect";
import { getDecoder, type Decoders } from "../formats/decoders";
import { cogSourceSpec } from "../formats/cog-spec";
import { FormatError } from "../formats/errors";
import { discard, openWhole } from "../formats/flatgeobuf";
import { TAIL_BYTES } from "../formats/geoparquet";
import {
  BodyTooLarge,
  fetchTail,
  fetchWhole,
  httpError,
  isEncodedRange,
  rangeRepliesUnreadable,
} from "../formats/http";
import { registerSourceDataLoader, type SourceDataLoader } from "../data/source-data";
import { recordPropertyNames } from "../data/property-names";
import {
  commandStem,
  formatCount,
  indexedFlatGeobufCommand,
  largeDataLinks,
  pmtilesCommand,
  raiseCost,
  sortedParquetCommand,
  wholeFileCause,
  type WholeFileCost,
} from "../components/student-messages";
import { consoleText } from "../utils/console-text";
import type { CloudHost, ColumnChoice, SizeLimits, StartedOpen, StartedTail } from "./cloud-host";
// No maplibre-gl here: the layer manager imports this module, and it loads
// without maplibre-gl (types only). Protocol registration, which needs the
// module, lives in ./cloud-protocols (MapRenderer only).

export type { ColumnChoice, FlatGeobufCallbacks, FormatLoader, SizeLimits } from "./cloud-host";

// ---------------------------------------------------------------------------
// Size guards and viewport defaults (design §4.4; maintainer-accepted)
// ---------------------------------------------------------------------------

/** Above this a whole-file FlatGeobuf read still loads, with console advice. */
export const WHOLE_FILE_WARN_BYTES = 10 * 1024 * 1024;
/**
 * Above this a whole-file read is not attempted: an indexed file switches to
 * reading the part in view; an unindexed one is refused with a notice.
 */
export const WHOLE_FILE_MAX_BYTES = 50 * 1024 * 1024;
/**
 * Above this many features (a FlatGeobuf header's count, a GeoParquet
 * footer's rows) a whole-file read is not attempted either, whatever the
 * bytes (ml-37r.16): the cost of a whole read is the features it decodes on
 * the page, and compressed bytes hide it. An author's `load: { maxFeatures }`
 * above it raises it for that source.
 *
 * @remarks
 * Measured on NYC PLUTO parcels (Chromium, desktop with a GPU, 2026-10-23/24):
 * Brooklyn's 275,628 parcels read whole draw in 13–17 s at 2.1–2.3 GB of
 * renderer memory and pan at 42–50 fps, as GeoJSON or GeoParquet — usable,
 * and what 0.9.1 did, so a file that size still loads whole. The citywide
 * 856,687 parcels, whose read columns were 47 MB on the wire (under
 * {@link WHOLE_FILE_MAX_BYTES}), decode to 142 MB and took 3.9–4.3 GB.
 * 400,000 sits between the two; {@link WHOLE_FILE_MAX_DECODED_BYTES} is the
 * safety net for fewer, heavier features — and for an author who raised the
 * feature limit (the citywide file trips both).
 */
export const WHOLE_FILE_MAX_FEATURES = 400_000;
/**
 * Above this many decoded bytes of the columns a map reads (a GeoParquet
 * footer's uncompressed sizes) a whole-file read is not attempted: few
 * features with heavy geometry cost as much as many light ones, and an
 * author's `maxFeatures` doesn't lift it.
 *
 * @remarks
 * Measured on NYC PLUTO (zstd GeoParquet): the citywide map's 7 read
 * columns decode to 142 MB (the geometry alone to 111 MB) and drawing them
 * took 4.3 GB; Brooklyn's decode to 44 MB (2.3–2.5 GB). 100 MB catches the
 * citywide file whatever its columns, passes the borough, and matches the
 * 600,000 parcels a hint may suggest loading whole (formats/large-data).
 * It was 150 MB, which the real citywide file passed.
 */
export const WHOLE_FILE_MAX_DECODED_BYTES = 100 * 1024 * 1024;
// `load:` is read by `loadModeOf` in formats/detect (side-effect free, so the
// parser's classify check can use it too); re-exported here for the renderer.
export {
  VIEWPORT_DEFAULT_MINZOOM,
  VIEWPORT_DEFAULT_MAX_FEATURES,
  loadModeOf,
  type LoadMode,
} from "../formats/detect";

/** Keys that are ours, never MapLibre's: stripped before a source reaches it. */
export const FORMAT_SOURCE_KEYS = ["format", "load", "columns", "colorRamp"] as const;

type Obj = Record<string, unknown>;

/** `spec` without our format keys (unchanged when it has none). */
export function withoutFormatKeys<T extends Obj>(spec: T): T {
  if (!FORMAT_SOURCE_KEYS.some((k) => k in spec)) return spec;
  const copy: Obj = { ...spec };
  for (const key of FORMAT_SOURCE_KEYS) delete copy[key];
  return copy as T;
}

// ---------------------------------------------------------------------------
// Tile sources (PMTiles, COG)
// ---------------------------------------------------------------------------

/** `url` resolved against the page (absolute), or as given outside a browser. */
export function absoluteUrl(url: string): string {
  const base = typeof document !== "undefined" ? document.baseURI : undefined;
  if (!base) return url;
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/** The "can't read" error for a format recognized ahead of its reader (none in 0.9). */
export function unsupportedFormatError(format: CloudFormat, url: string): FormatError {
  return new FormatError({ code: "unsupported", format, url: stripScheme(url) });
}

/**
 * The MapLibre spec for a tile source (`vector`, `raster`, `raster-dem`)
 * that may name a cloud-native file.
 *
 * @returns `spec` — the input without our keys, with a PMTiles URL rewritten
 *   to `pmtiles://<absolute>` and a COG's to `cog://<absolute>` (see
 *   `formats/cog-spec`) — and `problem` when the source can't be read in
 *   this version; the spec is then an empty placeholder of the same type, so
 *   layers over it are added and draw nothing instead of each failing on a
 *   missing source.
 * @param _isRegistered - Whether the page registered a URL protocol itself
 *   (unused since COG is read YAML-only; kept for callers).
 */
export function toMapLibreTileSpec(
  spec: Obj,
  _isRegistered: (scheme: string) => boolean = () => false
): { spec: Obj; problem?: FormatError } {
  const clean = withoutFormatKeys(spec);
  const format = formatOfSource(spec);
  const url = spec["url"];
  if (!format || typeof url !== "string" || !typeReadsFormat(spec["type"], format)) {
    return { spec: clean };
  }
  if (format === "pmtiles") {
    return { spec: { ...clean, url: `pmtiles://${absoluteUrl(stripScheme(url))}` } };
  }
  if (format === "cog") {
    // `cog://<absolute>`, `#dem` / `#color:` and tileSize 256 (ml-cnv.2).
    return { spec: cogSourceSpec({ ...clean, colorRamp: spec["colorRamp"] }, absoluteUrl) };
  }
  return { spec: placeholderTileSpec(spec["type"]), problem: unsupportedFormatError(format, url) };
}

/** A 1×1 transparent PNG. */
const TRANSPARENT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

/**
 * A tile source of `type` that draws nothing and requests nothing: its
 * bounds are a sliver at the edge of the world, and the one tile it names
 * is a transparent pixel (MapLibre needs a non-empty `tiles` list).
 */
function placeholderTileSpec(type: unknown): Obj {
  return {
    type,
    tiles: [TRANSPARENT_PNG],
    tileSize: 256,
    bounds: [-180, -85, -179.9999, -84.9999],
    maxzoom: 0,
  };
}

// ---------------------------------------------------------------------------
// FlatGeobuf and GeoParquet: the size guards
// ---------------------------------------------------------------------------

/** A whole-file read refused for size: the caller reads by view instead. */
export class WholeFileTooLarge extends Error {
  /**
   * @param size - The bytes a whole read would transfer, when known.
   * @param opened - The file already opened (GeoParquet: its footer), reused
   *   by the by-view read instead of a second open.
   * @param features - The feature count, when that is what decided (ml-37r.16).
   * @param cost - What the read would cost against which limits (the notes
   *   and notices name the one it is over).
   */
  constructor(
    readonly size?: number,
    readonly opened?: unknown,
    readonly features?: number,
    readonly cost?: Omit<WholeFileCost, "format">
  ) {
    super("too large to load whole");
    this.name = "WholeFileTooLarge";
  }
}

const DEFAULT_LIMITS: Required<SizeLimits> = {
  warn: WHOLE_FILE_WARN_BYTES,
  max: WHOLE_FILE_MAX_BYTES,
  maxFeatures: WHOLE_FILE_MAX_FEATURES,
  maxDecoded: WHOLE_FILE_MAX_DECODED_BYTES,
};

/**
 * The size guards in force: the defaults, then any a browser test set on
 * `globalThis.__MAPLIBRE_YAML_LIMITS__` (a test hook, so a small fixture can
 * stand in for a large file — not an authoring option), then `given`; then
 * the author's `load: { maxFeatures }`, which raises the feature limit (never
 * lowers it).
 */
export function sizeLimits(given?: SizeLimits, load?: Pick<LoadMode, "authorMaxFeatures">): Required<SizeLimits> {
  const hook = (globalThis as { __MAPLIBRE_YAML_LIMITS__?: Partial<SizeLimits> }).__MAPLIBRE_YAML_LIMITS__;
  const limits = { ...DEFAULT_LIMITS, ...hook, ...given } as Required<SizeLimits>;
  if (load?.authorMaxFeatures !== undefined && load.authorMaxFeatures > limits.maxFeatures) {
    limits.maxFeatures = load.authorMaxFeatures;
  }
  return limits;
}

/**
 * A source's resolved `columns` (the explicit list or `all` an author or
 * {@link geoParquetColumns} put there); every column when absent.
 */
export function columnChoiceOf(source: Readonly<Record<string, unknown>>): ColumnChoice {
  const columns = source["columns"];
  if (Array.isArray(columns)) return columns.filter((c): c is string => typeof c === "string");
  return "all";
}
// ---------------------------------------------------------------------------
// FlatGeobuf and GeoParquet: the reader chunks (bundle headroom, U5)
// ---------------------------------------------------------------------------

/** The formats whose data provider is in its reader's chunk. */
export type ReaderFormat = "flatgeobuf" | "geoparquet";

/**
 * Everything the reader chunks use from core, built once: they import core
 * as types only (see ./cloud-host).
 *
 * @internal
 */
export const cloudHost: CloudHost = {
  formatError: (failure) => new FormatError(failure),
  getDecoder: (name) => getDecoder(name),
  BodyTooLarge,
  WholeFileTooLarge,
  sizeLimits,
  openWhole,
  discard,
  fetchTail,
  fetchWhole,
  httpError,
  isEncodedRange,
  rangeRepliesUnreadable,
  consoleText,
  recordPropertyNames,
  messages: {
    commandStem,
    formatCount,
    indexedFlatGeobufCommand,
    largeDataLinks,
    pmtilesCommand,
    raiseCost,
    sortedParquetCommand,
    wholeFileCause,
  },
};

/** The reader chunks already loaded and given the host, by format. */
const ready = new Map<ReaderFormat, Decoders[ReaderFormat]>();

/**
 * A format's reader chunk — its library, adapter and data provider —
 * downloaded on first use (through the seam, so a failed download is the
 * seam's `chunk` {@link FormatError} and the next call retries it) and
 * given the {@link cloudHost} before anything in it runs.
 */
export function cloudReaders<F extends ReaderFormat>(format: F): Promise<Decoders[F]> {
  return getDecoder(format).then((readers) => {
    if (ready.get(format) !== readers) {
      readers.useHost(cloudHost);
      ready.set(format, readers);
    }
    return readers;
  });
}

/**
 * A format's reader chunk when it has already loaded ({@link cloudReaders}),
 * else undefined: what lets the layer manager start a reader without waiting
 * a turn when there is nothing to wait for.
 */
export function loadedCloudReaders<F extends ReaderFormat>(format: F): Decoders[F] | undefined {
  return ready.get(format) as Decoders[F] | undefined;
}

/**
 * Start a FlatGeobuf file's whole-file `GET` now, while its reader chunk
 * downloads; the reader takes the response when it arrives
 * (`loadFlatGeobufWhole`'s `started`).
 */
export function startFlatGeobufOpen(url: string): StartedOpen {
  const abort = new AbortController();
  const opened = openWhole(url, abort.signal);
  // Awaited by the reader; a failure before it does is not unhandled.
  opened.catch(() => undefined);
  return { opened, abort };
}

/**
 * Start a GeoParquet file's footer read now (the request `open` starts
 * with), while its reader chunk downloads.
 *
 * @param maxWholeBytes - The source's whole-file limit (`sizeLimits().max`),
 *   as the reader would pass it.
 */
export function startGeoParquetTail(url: string, maxWholeBytes: number): StartedTail {
  const abort = new AbortController();
  const tail = fetchTail(url, TAIL_BYTES, { signal: abort.signal, maxWholeBytes });
  tail.catch(() => undefined);
  return { tail, abort };
}

/** Cancel a first request no reader will take (its chunk failed, or its source went away). */
export function abandonStarted(started: StartedOpen | StartedTail): void {
  started.abort.abort();
  if ("opened" in started) void started.opened.then(discard, () => undefined);
}

const emptyCollection = (): FeatureCollection => ({ type: "FeatureCollection", features: [] });

/**
 * The FlatGeobuf and GeoParquet entry on the shared source-data seam
 * (`data/source-data.ts`, ml-aot.75): a `fitTo` on a source read whole is
 * loaded — and decoded — ahead of the map, like a GeoJSON one, so the map is
 * built already framed on it. The layer manager then reuses that load (one
 * request). The file's first request starts here, alongside its reader
 * chunk's download; the chunk reads it. A source read by view, or a format
 * this version doesn't read, is not loaded ahead: the loader declines with a
 * rejection the prefetch settles on at once, and the layer manager reads the
 * source itself.
 */
export const cloudSourceDataLoader: SourceDataLoader = (source) => {
  const format = formatOfSource(source);
  if (!format || !typeReadsFormat(source["type"], format)) return undefined;
  const load = loadModeOf(source as Obj);
  if (format === "flatgeobuf" && load.mode === "all") {
    const url = String(source["url"]);
    const limits = sizeLimits(undefined, load);
    const started = startFlatGeobufOpen(url);
    return cloudReaders("flatgeobuf")
      .then(
        (readers) => readers.loadFlatGeobufWhole(url, { limits, started }),
        (error: unknown) => {
          abandonStarted(started);
          throw error;
        }
      )
      .then((data) => data ?? emptyCollection());
  }
  if (format === "geoparquet" && load.mode === "all") {
    const url = String(source["url"]);
    const limits = sizeLimits(undefined, load);
    const started = startGeoParquetTail(url, limits.max);
    return cloudReaders("geoparquet")
      .then(
        (readers) => readers.loadGeoParquetWhole(url, columnChoiceOf(source), { limits, started }),
        (error: unknown) => {
          abandonStarted(started);
          throw error;
        }
      )
      .then((read) => read.data ?? emptyCollection());
  }
  if (format === "flatgeobuf" || format === "geoparquet") {
    return Promise.reject(new Error(`${format}: not loaded ahead of the map`));
  }
  return undefined;
};

registerSourceDataLoader(cloudSourceDataLoader);

/**
 * Decode a whole FlatGeobuf file already in memory (`mlym emit` reads the
 * file from disk or the network, then converts it here). Node-safe. The
 * reader is downloaded on first use (the `flatgeobuf` on-demand module).
 *
 * @param bytes - The file.
 * @param url - Its name, for messages.
 */
export async function decodeFlatGeobuf(bytes: Uint8Array, url: string): Promise<FeatureCollection> {
  return (await cloudReaders("flatgeobuf")).decodeBytes(bytes, url);
}

/**
 * Decode a whole GeoParquet file already in memory (`mlym emit`, classify
 * breaks at export). Node-safe. The reader is downloaded on first use (the
 * `geoparquet` on-demand module).
 *
 * @param bytes - The file.
 * @param url - Its name, for messages.
 */
export async function decodeGeoParquet(
  bytes: Uint8Array,
  url: string,
  options: { columns?: ColumnChoice } = {}
): Promise<FeatureCollection> {
  return (await cloudReaders("geoparquet")).decodeBytes(bytes, url, options);
}
