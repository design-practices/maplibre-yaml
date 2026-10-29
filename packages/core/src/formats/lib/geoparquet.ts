/**
 * @file GeoParquet, as the `geoparquet` on-demand chunk sees it: the library, the adapter and the data provider (0.9, ml-cnv.4; bundle headroom U5)
 * @module @maplibre-yaml/core/formats/lib/geoparquet
 *
 * @description
 * GeoParquet is a columnar feature file. Core reads it into an ordinary
 * MapLibre GeoJSON source, so layers, popups, legend, `fitTo` and
 * clustering behave exactly as for a `.geojson` file.
 *
 * **All of it is downloaded on demand** (`chunks/geoparquet.js`, through the
 * seam, formats/decoders; `chunks/geoparquet-brotli.js` for a brotli file): a
 * page with no GeoParquet source never loads it. The main bundle keeps only
 * the footer request ({@link OpenOptions.started}), which it starts while
 * this chunk downloads, and hands over. What this module needs from core
 * comes through the host ({@link useHost}, see ./cloud-reader); it imports
 * core as types only.
 *
 * The library: hyparquet (its browser-safe entry: the package's Node export
 * adds a file reader that imports `fs`) and the decompressors that ship with
 * it: zstd, gzip and lz4 (snappy is hyparquet's own). Brotli is its own chunk
 * (./geoparquet-brotli).
 *
 * Reading, with `hyparquet` (WKB → GeoJSON built in):
 *
 * - **Open** ({@link open}): one suffix-range request
 *   (`Range: bytes=-524288`) returns the footer *and* the file size, so a
 *   small file is read in a single request and a large one never pays a
 *   `HEAD`. A server that ignores `Range` (`python -m http.server`) sends the
 *   whole file instead: it is kept in memory (if it fits the size guard)
 *   and every later read is served from it. A host that answers the suffix
 *   with 416 (Fastly: GitHub Pages, jsDelivr) or hides `Content-Range` from
 *   another origin costs one more request (formats/http `fetchTail`).
 * - **Column projection**: only the columns the caller names (the ones the
 *   document references) plus the geometry are read — the footer gives each
 *   column's compressed size, so the transfer is known before any data is.
 * - **Whole file** ({@link readAll}) or **part of it** ({@link readBbox}):
 *   the GeoParquet 1.1 `bbox` covering column's row-group statistics let
 *   whole row groups be skipped; the rows left are filtered by their bbox.
 * - **Codecs**: snappy is built into hyparquet; zstd, gzip and lz4 ship in
 *   this chunk; brotli (a large decoder) is its own chunk, loaded only when
 *   the file's footer says a column chunk uses it.
 * - **Encodings and CRS**: WKB geometry only (GeoArrow-native encodings are
 *   refused with how to rewrite the file); longitude/latitude only (the
 *   shared rule in formats/crs).
 * - **Facts** ({@link parquetFacts}, large data round 2 U6): what
 *   `mlym prepare` reports, from the footer alone, through any
 *   `AsyncBuffer` — naming a projected CRS or a GeoArrow encoding instead of
 *   refusing it. Node-safe: nothing here imports `node:`.
 *
 * Every failure becomes a `FormatError` with a plain-language message,
 * except an HTTP error status, which is thrown in the shape the GeoJSON
 * fetcher uses (`HTTP 404: Not Found for <url>`) so the notice words a
 * missing `.parquet` exactly like a missing `.geojson` (with the same `base`
 * advice).
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import type { AsyncBuffer, Compressors, FileMetaData, LogicalType } from "hyparquet";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { decompress as zstd } from "fzstd";
import { gunzip } from "hyparquet-compressors/src/gzip.js";
import { decompressLz4, decompressLz4Raw } from "hyparquet-compressors/src/lz4.js";
import { parquetMetadataAsync, parquetReadObjects } from "hyparquet/src/index.js";
import type { Tail } from "../http";
import type { LoadMode } from "../detect";
import type { ColumnChoice, FlatGeobufCallbacks, SizeLimits, StartedTail } from "../../renderer/cloud-host";
import type { WholeFileTooLarge } from "../../renderer/cloud-sources";
import { isLonLatCrs } from "../crs";
import { VIEWPORT_DEFAULT_MAX_FEATURES } from "../detect";
import { TAIL_BYTES } from "../geoparquet";
import { roundedRaise, SAFE_VIEW_FEATURES } from "../large-data";
import {
  costLimits,
  host,
  isAbortError,
  isFormatError,
  mb,
  noRangeNote,
  shareInView,
  ViewLoader,
  type BBox,
} from "./cloud-reader";

export { parquetMetadataAsync, parquetReadObjects, TAIL_BYTES };
export { shareInView, useHost, type BBox } from "./cloud-reader";
export type { ColumnChoice };

// ---------------------------------------------------------------------------
// The library's codecs, and rows → GeoJSON
// ---------------------------------------------------------------------------

/** Codecs beyond snappy, keyed as hyparquet names them. */
export const compressors: Compressors = {
  GZIP: (input, length) => gunzip(input, new Uint8Array(length)),
  ZSTD: (input) => zstd(input),
  LZ4: decompressLz4,
  LZ4_RAW: decompressLz4Raw,
};

// ---------------------------------------------------------------------------
// Rows → GeoJSON features
// ---------------------------------------------------------------------------

/**
 * A value MapLibre can carry as a feature property: 64-bit integers become
 * numbers (or strings beyond 2^53), dates ISO strings, bytes are dropped.
 */
function propertyValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Uint8Array) return undefined;
  if (Array.isArray(value)) return value.map(propertyValue);
  if (isObject(value)) {
    const out: Obj = {};
    for (const [k, v] of Object.entries(value)) {
      const converted = propertyValue(v);
      if (converted !== undefined) out[k] = converted;
    }
    return out;
  }
  return value;
}

/** Rows (objects) to features: the geometry column becomes the geometry. */
export function toFeatures(rows: readonly Obj[], geometryColumn: string, columns: readonly string[]): Feature[] {
  const features: Feature[] = [];
  for (const row of rows) {
    const geometry = row[geometryColumn] as Geometry | null | undefined;
    if (!geometry || typeof geometry !== "object") continue;
    const properties: Obj = {};
    for (const name of columns) {
      if (name === geometryColumn) continue;
      const value = propertyValue(row[name]);
      if (value !== undefined) properties[name] = value;
    }
    features.push({ type: "Feature", geometry, properties });
  }
  return features;
}

// ---------------------------------------------------------------------------
// The adapter: reading a file
// ---------------------------------------------------------------------------

/** What the file's GeoParquet metadata says, in the shape callers need. */
export interface GeoParquetInfo {
  /** The primary geometry column. */
  geometryColumn: string;
  /** The declared CRS, e.g. "EPSG:4326", when the file names one. */
  crs?: string;
  /** The file's extent, when the metadata records one. */
  bbox?: BBox;
  /**
   * The GeoParquet 1.1 bbox covering column's leaf paths
   * (`bbox.xmin` …), when the file has one: what reading by view filters on.
   */
  covering?: { xmin: string; ymin: string; xmax: string; ymax: string };
  /** The attribute columns (every top-level column but geometry and covering). */
  columns: string[];
  /** Number of row groups (of the canonical level, for an overview file). */
  rowGroups: number;
  /** Number of rows (features; of the canonical level, for an overview file). */
  rows: number;
  /** The file's `geo:overviews` pyramid, when it has one (see {@link Overviews}). */
  overviews?: Overviews;
}

/**
 * A run of row groups: groups `groupStart`..`groupEnd` (inclusive), rows
 * `rowStart`..`rowEnd` (exclusive, as hyparquet takes them) — what a read
 * and the by-view helpers are restricted to.
 */
export interface RowBand {
  groupStart: number;
  groupEnd: number;
  rowStart: number;
  rowEnd: number;
}

/** One `geo:overviews` level: its row groups and rows, and what it was built for. */
export interface OverviewLevel extends RowBand {
  /** The Web Mercator zoom the level was built for, when the footer says. */
  zoom?: number;
  /** The level's ground sample distance (metres per pixel), when the footer says. */
  gsd?: number;
}

/**
 * A GeoParquet overview file's levels (`geo:overviews`, draft spec 0.2.0,
 * written by tylertoo): each zoom level is a run of row groups, coarse to
 * fine. In `duplicating` mode each level is a complete copy of the data, so
 * a reader that reads every row draws each feature once per level (2,201
 * features for 601 parcels in the spike, ml-cnv.21): whole-file reads and
 * the size guards read only the canonical — full-detail — level, and a read
 * by view the level that fits the zoom ({@link overviewBand}, ml-cnv.22). In
 * `partitioning` mode each feature appears once: every row is the data, and
 * a zoom reads every level up to its own.
 */
export interface Overviews {
  /** The key's `version`, e.g. "0.2.0". */
  version: string;
  mode: "duplicating" | "partitioning";
  /** Every level, coarse to fine, the canonical one included. */
  levels: OverviewLevel[];
  /** Whether this version knows the key's major version (0). */
  known: boolean;
  /** The canonical level's index in {@link levels} (`duplicating` mode). */
  canonicalLevel?: number;
  /**
   * The canonical level's rows and row groups (`duplicating` mode) — what
   * every whole-file read and size check is restricted to.
   */
  canonical?: RowBand;
}

/** An opened GeoParquet file: its footer parsed, ready to read. */
export interface GeoParquetFile {
  url: string;
  /** Total file size in bytes. */
  byteLength: number;
  /** Whether the server honoured `Range:` (206). Without it the file is in memory. */
  ranges: boolean;
  metadata: FileMetaData;
  info: GeoParquetInfo;
  /** The reader hyparquet reads through. */
  file: AsyncBuffer;
}


// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The plain-language error for what `fetch` threw. */
function fetchFailure(error: unknown, url: string): unknown {
  if (isAbortError(error)) return error;
  return host().formatError({ code: "cors", format: "geoparquet", url });
}

/** Map what the library threw while reading to a classified error. */
function readFailure(error: unknown, url: string): unknown {
  if (isAbortError(error) || isFormatError(error)) return error;
  const e = error as { message?: unknown; status?: unknown } | null;
  if (typeof e?.status === "number") return error; // our own HTTP shape, from a range read
  const message = String(e?.message ?? error);
  if (/footer != PAR1|metadata length|parquet file invalid|unexpected end|out of bounds|outside the bounds/i.test(message)) {
    return host().formatError({ code: "not-format", format: "geoparquet", url });
  }
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return host().formatError({ code: "cors", format: "geoparquet", url });
  }
  return host().formatError({ code: "read", format: "geoparquet", url, detail: message });
}

// ---------------------------------------------------------------------------
// Opening: one suffix-range read, then ranges (or the whole file in memory)
// ---------------------------------------------------------------------------

const PAR1 = [0x50, 0x41, 0x52, 0x31];

/** Whether `bytes` ends (or starts, at `at`) with the Parquet magic `PAR1`. */
function hasMagic(bytes: Uint8Array, at: number): boolean {
  return at >= 0 && PAR1.every((b, i) => bytes[at + i] === b);
}

/**
 * A reader over a file whose last bytes (or all of it) are already in hand;
 * anything else is fetched with a range request.
 */
function rangeReader(
  url: string,
  byteLength: number,
  held: { start: number; bytes: ArrayBuffer },
  ranges: boolean,
  signal?: AbortSignal
): AsyncBuffer {
  return {
    byteLength,
    async slice(start: number, end: number = byteLength): Promise<ArrayBuffer> {
      if (start >= held.start && end <= held.start + held.bytes.byteLength) {
        return held.bytes.slice(start - held.start, end - held.start);
      }
      if (!ranges) throw host().formatError({ code: "no-range", format: "geoparquet", url });
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { Range: `bytes=${start}-${end - 1}` },
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        throw fetchFailure(error, url);
      }
      if (!response.ok) throw host().http.httpError(response, url);
      if (response.status !== 206) {
        void response.body?.cancel().catch(() => undefined);
        throw host().formatError({ code: "no-range", format: "geoparquet", url });
      }
      if (host().http.isEncodedRange(response)) {
        void response.body?.cancel().catch(() => undefined);
        throw host().formatError({ code: "encoded-range", format: "geoparquet", url });
      }
      return response.arrayBuffer();
    },
  };
}

/** Options for {@link open}. */
export interface OpenOptions {
  signal?: AbortSignal;
  /**
   * The largest file accepted when the whole file has to be read (a server
   * that ignores `Range:`, or a host that hides the file size): larger ones
   * are refused — before their body is read when the server says its size,
   * else as soon as that many bytes have arrived.
   */
  maxWholeBytes?: number;
  /** The first read's length (default {@link TAIL_BYTES}); tests pass a smaller one. */
  tailBytes?: number;
  /**
   * The first read, already started — by the main bundle, while this chunk
   * downloaded (the two overlap, as before the reader moved here). Read
   * with the default {@link TAIL_BYTES} and the same `maxWholeBytes`.
   */
  started?: StartedTail;
}

/**
 * Open a GeoParquet file: read its footer (one suffix-range request), check
 * the file is GeoParquet this version reads (WKB geometry, longitude/latitude).
 *
 * Works on hosts that answer an oversized suffix range with 416 (GitHub
 * Pages, raw.githubusercontent.com, jsDelivr) and on cross-origin hosts that
 * don't expose `Content-Range` — see formats/http `fetchTail`.
 *
 * @throws The `HTTP <status>` shape for an error status; a {@link FormatError}
 *   for CORS/unreachable (`cors`), wrong bytes (`not-format`), plain Parquet
 *   (`not-geoparquet`), GeoArrow geometry (`encoding`), a projected CRS
 *   (`crs`), or a file over `maxWholeBytes` that had to be read whole
 *   (`no-range` from a server without ranges, `too-large` otherwise).
 */
export async function open(url: string, options: OpenOptions = {}): Promise<GeoParquetFile> {
  const { signal } = options;
  const tailBytes = options.tailBytes ?? TAIL_BYTES;
  let tail: Tail;
  try {
    tail = await (options.started?.tail ??
      host().http.fetchTail(url, tailBytes, {
        ...(signal ? { signal } : {}),
        ...(options.maxWholeBytes !== undefined ? { maxWholeBytes: options.maxWholeBytes } : {}),
      }));
  } catch (error) {
    if (error instanceof host().BodyTooLarge) {
      // A whole file over the guard: from a server without ranges, the
      // hosting is what to fix; otherwise the file is simply too big to
      // read whole (a host that hid its size from this page).
      if (error.ranges === false) throw host().formatError({ code: "no-range", format: "geoparquet", url, size: error.size });
      // The whole file had to be read (the host hid its size), and it is
      // over the limit: its size is the file's, not the columns' (ml-cnv.33).
      throw host().formatError({
        code: "too-large",
        format: "geoparquet",
        url,
        size: error.size,
        sizeIsFile: true,
        ...(options.maxWholeBytes !== undefined ? { limits: { bytes: options.maxWholeBytes } } : {}),
        blocker: "no-size",
      });
    }
    if (typeof (error as { status?: unknown } | null)?.status === "number") throw error;
    throw fetchFailure(error, url);
  }

  const looksRight = (t: Tail) => {
    const b = new Uint8Array(t.bytes);
    return b.length >= 12 && hasMagic(b, b.length - 4) && (t.start !== 0 || hasMagic(b, 0));
  };
  if (!looksRight(tail) && tail.ranges && (await host().http.rangeRepliesUnreadable(url))) {
    // A host that answers ranges from a compressed copy (jsDelivr's
    // Cloudflare leg): the whole file, which the browser decodes, is right.
    try {
      tail = await host().http.fetchWhole(url, {
        ...(signal ? { signal } : {}),
        ...(options.maxWholeBytes !== undefined ? { maxWholeBytes: options.maxWholeBytes } : {}),
      });
    } catch (error) {
      if (error instanceof host().BodyTooLarge) {
        throw host().formatError({ code: "encoded-range", format: "geoparquet", url });
      }
      if (typeof (error as { status?: unknown } | null)?.status === "number") throw error;
      throw fetchFailure(error, url);
    }
  }
  if (!looksRight(tail)) throw host().formatError({ code: "not-format", format: "geoparquet", url });
  const held = { start: tail.start, bytes: tail.bytes };
  const file = rangeReader(url, tail.size, held, tail.ranges, signal);
  let metadata: FileMetaData;
  try {
    metadata = await parquetMetadataAsync(file, { initialFetchSize: tailBytes });
  } catch (error) {
    throw readFailure(error, url);
  }
  return { url, byteLength: tail.size, ranges: tail.ranges, metadata, info: geoInfo(metadata, url), file };
}

/**
 * Open a GeoParquet file already in memory (`mlym emit` reads it from disk
 * or the network). Node-safe.
 */
export async function openBytes(bytes: Uint8Array, url: string): Promise<GeoParquetFile> {
  if (bytes.length < 12 || !hasMagic(bytes, 0) || !hasMagic(bytes, bytes.length - 4)) {
    throw host().formatError({ code: "not-format", format: "geoparquet", url });
  }
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const file = rangeReader(url, buffer.byteLength, { start: 0, bytes: buffer }, false);
  let metadata: FileMetaData;
  try {
    metadata = await parquetMetadataAsync(file, { initialFetchSize: TAIL_BYTES });
  } catch (error) {
    throw readFailure(error, url);
  }
  return { url, byteLength: buffer.byteLength, ranges: false, metadata, info: geoInfo(metadata, url), file };
}

// ---------------------------------------------------------------------------
// GeoParquet metadata: geometry column, encoding, CRS, extent, covering
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** A 4- or 6-number extent as `[w, s, e, n]`. */
function toBBox(value: unknown): BBox | undefined {
  if (!Array.isArray(value) || !value.every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  if (value.length === 4) return [value[0], value[1], value[2], value[3]];
  if (value.length === 6) return [value[0], value[1], value[3], value[4]];
  return undefined;
}

/** The CRS a GeoParquet column declares: PROJJSON, a string, or nothing. */
function crsFacts(crs: unknown): { org?: string; code?: number | string; name?: string; projected?: boolean } {
  if (typeof crs === "string") {
    const m = /^(?:projjson:|srid:)?([A-Za-z]+):(\w+)$/.exec(crs.trim());
    if (m) return { org: m[1]!, code: m[2]!, name: `${m[1]!.toUpperCase()}:${m[2]!}` };
    const srid = /^srid:(\d+)$/i.exec(crs.trim());
    return srid ? { org: "EPSG", code: Number(srid[1]), name: `EPSG:${srid[1]}` } : { name: crs };
  }
  if (!isObject(crs)) return {};
  const id = (isObject(crs["id"]) ? crs["id"] : Array.isArray(crs["ids"]) ? crs["ids"][0] : undefined) as
    | { authority?: unknown; code?: unknown }
    | undefined;
  const org = typeof id?.authority === "string" ? id.authority : undefined;
  const code = typeof id?.code === "number" || typeof id?.code === "string" ? id.code : undefined;
  const name = org && code !== undefined ? `${org}:${code}` : typeof crs["name"] === "string" ? crs["name"] : undefined;
  return {
    ...(org ? { org } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(name ? { name } : {}),
    ...(crs["type"] === "ProjectedCRS" ? { projected: true } : {}),
  };
}

/** A finite number, or undefined. */
const finite = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * The `geo:overviews` key (or its planned home, `geo.overviews`), read into
 * {@link Overviews}; undefined when the file has none, or one whose levels
 * don't tile the row groups (then it is read as plain GeoParquet).
 */
export function parseOverviews(metadata: Pick<FileMetaData, "key_value_metadata" | "row_groups">, geo: Obj | undefined): Overviews | undefined {
  const text = metadata.key_value_metadata?.find((kv) => kv.key === "geo:overviews")?.value;
  let raw: unknown = isObject(geo?.["overviews"]) ? geo!["overviews"] : undefined;
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      return undefined;
    }
  }
  if (!isObject(raw) || !Array.isArray(raw["levels"]) || raw["levels"].length === 0) return undefined;
  const version = String(raw["version"] ?? "");
  const mode = raw["mode"] === "partitioning" ? "partitioning" : "duplicating";
  const groups = metadata.row_groups;
  const levels = raw["levels"] as unknown[];
  // Each level ends at a row group (inclusive); together they cover every
  // group, in order. Rows are counted from the footer's `num_rows`.
  const parsed: OverviewLevel[] = [];
  let groupStart = 0;
  let rowStart = 0;
  for (const level of levels) {
    const end = isObject(level) ? Number(level["row_group_end"]) : NaN;
    if (!Number.isInteger(end) || end < groupStart || end >= groups.length) return undefined;
    let rowEnd = rowStart;
    for (let i = groupStart; i <= end; i++) rowEnd += Number(groups[i]!.num_rows);
    const zoom = finite((level as Obj)["zoom"]);
    const gsd = finite((level as Obj)["gsd"]);
    parsed.push({
      groupStart,
      groupEnd: end,
      rowStart,
      rowEnd,
      ...(zoom !== undefined ? { zoom } : {}),
      ...(gsd !== undefined ? { gsd } : {}),
    });
    groupStart = end + 1;
    rowStart = rowEnd;
  }
  if (groupStart !== groups.length) return undefined;
  const overviews: Overviews = { version, mode, levels: parsed, known: version.split(".")[0] === "0" };
  if (mode === "duplicating") {
    const declared = raw["canonical_level"];
    const index = typeof declared === "number" && Number.isInteger(declared) && declared >= 0 && declared < parsed.length
      ? declared
      : parsed.length - 1;
    overviews.canonicalLevel = index;
    overviews.canonical = rowBand(parsed[index]!);
  }
  return overviews;
}

/** Just the rows and row groups of a band (or level). */
function rowBand({ groupStart, groupEnd, rowStart, rowEnd }: RowBand): RowBand {
  return { groupStart, groupEnd, rowStart, rowEnd };
}

/** What {@link overviewBand} chose: the rows to read, and the level they end at. */
export interface OverviewBand extends RowBand {
  /** The index (in {@link Overviews.levels}) of the finest level read. */
  level: number;
  /**
   * Set when the zoom couldn't choose: `no-zoom` — a level declares neither
   * `zoom` nor a usable `gsd`, so the canonical level (every row, in
   * `partitioning` mode) is read.
   */
  fallback?: "no-zoom";
}

/** Web Mercator's equator, in metres: the spec's `gsd` ↔ zoom mapping (1024-px tiles). */
const EQUATOR_M = 40075016.69;
/** Slack when comparing a level's zoom (derived from `gsd`, a float) with the map's. */
const ZOOM_EPSILON = 1e-6;

/**
 * The zoom a level was built for: its `zoom`, or one from its `gsd` by the
 * spec's equatorial rule (`log2(40075016.69 / 1024 / gsd)`, metres, no
 * latitude correction); undefined with neither.
 */
function levelZoom(level: OverviewLevel): number | undefined {
  if (level.zoom !== undefined) return level.zoom;
  if (level.gsd === undefined || !(level.gsd > 0)) return undefined;
  return Math.log2(EQUATOR_M / 1024 / level.gsd);
}

/**
 * The rows an overview file's read by view takes at map zoom `zoom`: the
 * finest level whose zoom is at or below `floor(zoom)` — the coarsest when
 * the map is below every level — so a GeoParquet view shows the
 * generalisation a PMTiles export of the same file shows between tile zoom
 * *k* and *k*+1. `partitioning` mode reads every level up to that one (each
 * feature sits only at its coarsest level).
 *
 * @returns undefined for a file without overviews, or with a major version
 *   this version doesn't know (it is read at its canonical level, as
 *   0.9.2); the canonical band, flagged `no-zoom`, when a level declares
 *   neither `zoom` nor `gsd`.
 */
export function overviewBand(overviews: Overviews | undefined, zoom: number): OverviewBand | undefined {
  if (!overviews?.known || overviews.levels.length === 0) return undefined;
  const { levels } = overviews;
  const last = levels.length - 1;
  const partitioning = overviews.mode === "partitioning";
  const band = (index: number, fallback?: "no-zoom"): OverviewBand => {
    const level = levels[index]!;
    const rows = partitioning ? { ...rowBand(level), groupStart: 0, rowStart: 0 } : rowBand(level);
    return { ...rows, level: index, ...(fallback ? { fallback } : {}) };
  };
  const zooms = levels.map(levelZoom);
  if (zooms.some((z) => z === undefined)) {
    return partitioning
      ? band(last, "no-zoom")
      : band(overviews.canonicalLevel ?? last, "no-zoom");
  }
  const target = Math.floor(zoom) + ZOOM_EPSILON;
  // The finest level at or below the target; else the coarsest of all.
  let chosen = -1;
  let coarsest = 0;
  zooms.forEach((z, i) => {
    if (z! <= target && (chosen < 0 || z! >= zooms[chosen]!)) chosen = i;
    if (z! < zooms[coarsest]!) coarsest = i;
  });
  return band(chosen < 0 ? coarsest : chosen);
}

/**
 * The row groups that hold the file's data, with their indexes: `band`'s
 * (an overview level, {@link overviewBand}), else every one, or an overview
 * file's canonical level (ml-cnv.21).
 */
export function dataRowGroups(
  source: GeoParquetFile,
  band: RowBand | undefined = source.info.overviews?.canonical
): { group: FileMetaData["row_groups"][number]; index: number }[] {
  const all = source.metadata.row_groups.map((group, index) => ({ group, index }));
  return band ? all.slice(band.groupStart, band.groupEnd + 1) : all;
}

/** The file's top-level columns (a struct's children are not columns of their own). */
function topLevelColumns(metadata: FileMetaData): { name: string; logical_type?: LogicalType }[] {
  const out: { name: string; logical_type?: LogicalType }[] = [];
  const { schema } = metadata;
  // schema[0] is the root; a group's descendants follow it depth-first.
  const skip = (i: number): number => {
    let next = i + 1;
    for (let c = 0; c < (schema[i]!.num_children ?? 0); c++) next = skip(next);
    return next;
  };
  for (let i = 1; i < schema.length; i = skip(i)) {
    const element = schema[i]!;
    out.push({ name: element.name, ...(element.logical_type ? { logical_type: element.logical_type } : {}) });
  }
  return out;
}

/** What a footer's GeoParquet metadata says, before anything is refused. */
interface GeoMetadata {
  info: GeoParquetInfo;
  /** The geometry column's `encoding` (`WKB`, or a GeoArrow name). */
  encoding: string;
  /** Whether the CRS is longitude/latitude (the shared rule in ../crs). */
  lonLat: boolean;
  /** The column's declared `geometry_types` (empty when it declares none). */
  geometryTypes: string[];
}

/**
 * Read the GeoParquet facts from a parsed footer, and refuse what this
 * version can't draw.
 */
export function geoInfo(metadata: FileMetaData, url: string): GeoParquetInfo {
  const { info, encoding, lonLat } = geoMetadata(metadata, url);
  if (encoding.toUpperCase() !== "WKB") {
    throw host().formatError({ code: "encoding", format: "geoparquet", url, encoding });
  }
  if (!lonLat) {
    throw host().formatError({
      code: "crs",
      format: "geoparquet",
      url,
      ...(info.crs ? { crs: info.crs } : {}),
    });
  }
  return info;
}

/**
 * The GeoParquet facts of a parsed footer, refusing only a file that isn't
 * GeoParquet at all (`not-geoparquet`): {@link geoInfo} refuses what this
 * version can't draw; {@link parquetFacts} reports it.
 */
function geoMetadata(metadata: FileMetaData, url: string): GeoMetadata {
  const schema = topLevelColumns(metadata);
  const topColumns = schema.map((c) => c.name);
  const geoText = metadata.key_value_metadata?.find((kv) => kv.key === "geo")?.value;
  let geo: Obj | undefined;
  try {
    geo = geoText ? (JSON.parse(geoText) as Obj) : undefined;
  } catch {
    geo = undefined;
  }
  const columns = isObject(geo?.["columns"]) ? (geo!["columns"] as Obj) : undefined;
  let geometryColumn =
    typeof geo?.["primary_column"] === "string" ? (geo["primary_column"] as string) : Object.keys(columns ?? {})[0];
  let column: Obj | undefined = geometryColumn && isObject(columns?.[geometryColumn]) ? (columns![geometryColumn] as Obj) : undefined;

  if (!column) {
    // No `geo` key: Parquet's own GEOMETRY / GEOGRAPHY logical type (newer
    // writers) carries WKB too.
    const native = schema.find((c) => {
      const t = (c.logical_type as { type?: string } | undefined)?.type;
      return t === "GEOMETRY" || t === "GEOGRAPHY";
    });
    if (!native) throw host().formatError({ code: "not-geoparquet", format: "geoparquet", url });
    geometryColumn = native.name;
    const crs = (native.logical_type as { crs?: unknown }).crs;
    column = { encoding: "WKB", ...(crs !== undefined ? { crs } : {}) };
  }

  const encoding = String(column["encoding"] ?? "WKB");
  const bbox = toBBox(column["bbox"]);
  // `crs` absent means OGC:CRS84 (the spec's default); `null` means unknown.
  const facts = "crs" in column ? crsFacts(column["crs"]) : { org: "OGC", code: "CRS84" };
  const lonLat = !facts.projected && isLonLatCrs({ org: facts.org, code: facts.code, envelope: bbox });
  const types = column["geometry_types"];
  const geometryTypes = Array.isArray(types) ? types.filter((t): t is string => typeof t === "string") : [];

  const covering = isObject(column["covering"]) && isObject((column["covering"] as Obj)["bbox"])
    ? ((column["covering"] as Obj)["bbox"] as Obj)
    : undefined;
  const path = (key: string) => {
    const p = covering?.[key];
    return Array.isArray(p) && p.every((s) => typeof s === "string") ? p.join(".") : undefined;
  };
  const cover = covering
    ? { xmin: path("xmin"), ymin: path("ymin"), xmax: path("xmax"), ymax: path("ymax") }
    : undefined;
  const coveringPaths =
    cover && cover.xmin && cover.ymin && cover.xmax && cover.ymax
      ? (cover as { xmin: string; ymin: string; xmax: string; ymax: string })
      : undefined;
  const coveringColumn = coveringPaths?.xmin.split(".")[0];
  const overviews = parseOverviews(metadata, geo);
  const band = overviews?.canonical;

  const info: GeoParquetInfo = {
    geometryColumn: geometryColumn!,
    ...(facts.name ? { crs: facts.name } : {}),
    ...(bbox ? { bbox } : {}),
    ...(coveringPaths ? { covering: coveringPaths } : {}),
    columns: topColumns.filter((name) => name !== geometryColumn && name !== coveringColumn),
    rowGroups: band ? band.groupEnd - band.groupStart + 1 : metadata.row_groups.length,
    rows: band ? band.rowEnd - band.rowStart : Number(metadata.num_rows),
    ...(overviews ? { overviews } : {}),
  };
  return { info, encoding, lonLat, geometryTypes };
}

// ---------------------------------------------------------------------------
// Facts: what `mlym prepare` reports (large data round 2, U6; KTD12)
// ---------------------------------------------------------------------------

/** One overview level, as {@link GeoParquetFacts} reports it. */
export interface GeoParquetLevelFacts {
  /** The Web Mercator zoom the level was built for, when the footer says. */
  zoom?: number;
  /** Its ground sample distance (metres per pixel), when the footer says. */
  gsd?: number;
  /** Rows (features) in the level. */
  rows: number;
  /** Row groups in the level. */
  rowGroups: number;
}

/** A GeoParquet file's facts, from its footer alone ({@link parquetFacts}). */
export interface GeoParquetFacts {
  format: "geoparquet";
  /** The file's size in bytes (the buffer's `byteLength`). */
  byteLength: number;
  /** Rows (features) a map reads: the canonical level's, for an overview file. */
  rows: number;
  /** Row groups a map reads: the canonical level's, for an overview file. */
  rowGroups: number;
  /** Every row in the file (every level's, for an overview file). */
  totalRows: number;
  /** Every row group in the file. */
  totalRowGroups: number;
  /** The smallest and largest of the {@link rowGroups}' row counts (0 and 0 without any). */
  rowsPerRowGroup: { min: number; max: number };
  /** The primary geometry column. */
  geometryColumn: string;
  /** Its `encoding`: `WKB` (what this version reads), or a GeoArrow name (`point`, …). */
  encoding: string;
  /** Its declared `geometry_types` (empty when it declares none). */
  geometryTypes: string[];
  /** The declared CRS, e.g. "EPSG:4326" or "EPSG:3857", when the file names one. */
  crs?: string;
  /** Whether the CRS is longitude/latitude — what this version draws. */
  lonLat: boolean;
  /** The file's extent `[w, s, e, n]`, when the metadata records one. */
  bbox?: BBox;
  /** The GeoParquet 1.1 bbox covering column's name (`bbox`), absent without one. */
  bboxColumn?: string;
  /**
   * Whether the row groups are spatially sorted, as a read by view judges
   * it ({@link canSkipByView}): `sorted`, `unsorted`, or `unknown` — no
   * bbox column, fewer than two row groups, or groups without its statistics.
   */
  spatialOrder: "sorted" | "unsorted" | "unknown";
  /** The attribute columns (every top-level column but geometry and the bbox column). */
  columns: string[];
  /** The compression codecs the column chunks use (`ZSTD`, `SNAPPY`, …). */
  compression: string[];
  /** The file's `geo:overviews` pyramid, when it has one ({@link parseOverviews}). */
  overviews?: {
    version: string;
    mode: "duplicating" | "partitioning";
    /** Whether this version knows the key's major version. */
    known: boolean;
    /** The canonical level's index in {@link levels} (`duplicating` mode). */
    canonicalLevel?: number;
    /** Coarse to fine, the canonical one included. */
    levels: GeoParquetLevelFacts[];
  };
}

/**
 * Read a GeoParquet file's facts through any `AsyncBuffer` — a file handle
 * in the CLI, a range reader over HTTP — touching only its first 4 bytes and
 * its footer. A projected CRS or a GeoArrow encoding is reported, not
 * refused; Node-safe.
 *
 * @param name - The file's name or URL, for messages.
 * @throws A {@link FormatError}: `not-format` (not Parquet), `not-geoparquet`
 *   (Parquet without geometry), `read` (a footer the library can't parse).
 */
export async function parquetFacts(buffer: AsyncBuffer, name: string): Promise<GeoParquetFacts> {
  let metadata: FileMetaData;
  try {
    if (!(buffer.byteLength >= 12) || !hasMagic(new Uint8Array(await buffer.slice(0, 4)), 0)) {
      throw host().formatError({ code: "not-format", format: "geoparquet", url: name });
    }
    // 8: the footer's length and magic first, then exactly the footer.
    metadata = await parquetMetadataAsync(buffer, { initialFetchSize: 8 });
  } catch (error) {
    throw readFailure(error, name);
  }
  const { info, encoding, lonLat, geometryTypes } = geoMetadata(metadata, name);
  const source: GeoParquetFile = { url: name, byteLength: buffer.byteLength, ranges: true, metadata, info, file: buffer };
  const counts = dataRowGroups(source).map(({ group }) => Number(group.num_rows));
  const extents = rowGroupExtents(source);
  const spatialOrder =
    extents.length < 2 || extents.some((e) => !e) ? "unknown" : canSkipByView(source) ? "sorted" : "unsorted";
  const codecs = new Set<string>();
  for (const group of metadata.row_groups) {
    for (const chunk of group.columns) if (chunk.meta_data) codecs.add(chunk.meta_data.codec);
  }
  const overviews = info.overviews;
  return {
    format: "geoparquet",
    byteLength: buffer.byteLength,
    rows: info.rows,
    rowGroups: info.rowGroups,
    totalRows: Number(metadata.num_rows),
    totalRowGroups: metadata.row_groups.length,
    rowsPerRowGroup: counts.length > 0 ? { min: Math.min(...counts), max: Math.max(...counts) } : { min: 0, max: 0 },
    geometryColumn: info.geometryColumn,
    encoding,
    geometryTypes,
    ...(info.crs ? { crs: info.crs } : {}),
    lonLat,
    ...(info.bbox ? { bbox: info.bbox } : {}),
    ...(info.covering ? { bboxColumn: info.covering.xmin.split(".")[0]! } : {}),
    spatialOrder,
    columns: info.columns,
    compression: [...codecs],
    ...(overviews
      ? {
          overviews: {
            version: overviews.version,
            mode: overviews.mode,
            known: overviews.known,
            ...(overviews.canonicalLevel !== undefined ? { canonicalLevel: overviews.canonicalLevel } : {}),
            levels: overviews.levels.map((level) => ({
              ...(level.zoom !== undefined ? { zoom: level.zoom } : {}),
              ...(level.gsd !== undefined ? { gsd: level.gsd } : {}),
              rows: level.rowEnd - level.rowStart,
              rowGroups: level.groupEnd - level.groupStart + 1,
            })),
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Projection, size, sortedness
// ---------------------------------------------------------------------------

/** The top-level columns a read fetches: the chosen attributes that exist, plus geometry. */
export function columnsToRead(source: GeoParquetFile, columns: ColumnChoice): string[] {
  const { info } = source;
  const wanted = columns === "all" ? info.columns : info.columns.filter((c) => columns.includes(c));
  return [...wanted, info.geometryColumn];
}

/**
 * The compressed bytes a whole-file read of `columns` transfers, from the
 * footer's per-column-chunk sizes (known before any data is read).
 */
export function projectedBytes(source: GeoParquetFile, columns: ColumnChoice): number {
  return projectedSize(source, columns)[0];
}

/**
 * What a whole-file read of `columns` costs, from the footer alone:
 * `[compressed bytes transferred, uncompressed bytes decoded]`. The second is
 * what decoding holds in memory (ml-37r.16: a file whose read columns are
 * 47 MB on the wire can be several times that once decompressed). `band`:
 * an overview level's row groups instead of the canonical level's.
 */
export function projectedSize(source: GeoParquetFile, columns: ColumnChoice, band?: RowBand): [number, number] {
  const read = new Set(columnsToRead(source, columns));
  let total = 0;
  let decoded = 0;
  for (const { group } of dataRowGroups(source, band)) {
    for (const chunk of group.columns) {
      const meta = chunk.meta_data;
      if (meta && read.has(meta.path_in_schema[0]!)) {
        total += Number(meta.total_compressed_size);
        decoded += Number(meta.total_uncompressed_size);
      }
    }
  }
  return [total, decoded];
}

/**
 * About how many rows a read of `view` returns, from the footer alone: each
 * row group's rows times the share of its covering extent the view covers
 * (rows spread evenly within a group, which is what spatially sorted groups
 * make roughly true). A group without statistics counts whole. `band`: an
 * overview level's row groups instead of the canonical level's.
 */
export function rowsInView(source: GeoParquetFile, view: BBox, band?: RowBand): number {
  const extents = rowGroupExtents(source, band);
  let rows = 0;
  dataRowGroups(source, band).forEach(({ group }, i) => {
    const extent = extents[i];
    rows += Number(group.num_rows) * (extent ? shareInView(extent, view) : 1);
  });
  return Math.round(rows);
}

/**
 * What reading `view` decodes, from the footer alone: the row groups whose
 * covering extent the view touches (a group without statistics counts), and
 * all their rows — a reader decodes a row group whole and filters its rows
 * afterwards, so a view holding 145,000 features of a file in 100,000-row
 * groups decoded about 600,000 rows. `largest` is the biggest group's rows.
 * `band`: an overview level's row groups instead of the canonical level's.
 */
export function rowGroupsInView(
  source: GeoParquetFile,
  view: BBox,
  band?: RowBand
): { groups: number; rows: number; largest: number } {
  const extents = rowGroupExtents(source, band);
  let groups = 0;
  let rows = 0;
  let largest = 0;
  dataRowGroups(source, band).forEach(({ group }, i) => {
    const n = Number(group.num_rows);
    largest = Math.max(largest, n);
    const extent = extents[i];
    if (extent && shareInView(extent, view) === 0) return;
    groups++;
    rows += n;
  });
  return { groups, rows, largest };
}

/**
 * The bbox each data row group's covering statistics describe (undefined
 * without stats), in {@link dataRowGroups} order (of `band`, else the canonical level).
 */
function rowGroupExtents(source: GeoParquetFile, band?: RowBand): (BBox | undefined)[] {
  const cover = source.info.covering;
  if (!cover) return [];
  return dataRowGroups(source, band).map(({ group }) => {
    const stat = (path: string, which: "min" | "max"): number | undefined => {
      const chunk = group.columns.find((c) => c.meta_data?.path_in_schema.join(".") === path);
      const s = chunk?.meta_data?.statistics;
      const v = which === "min" ? (s?.min_value ?? s?.min) : (s?.max_value ?? s?.max);
      return typeof v === "number" && Number.isFinite(v) ? v : undefined;
    };
    const w = stat(cover.xmin, "min");
    const s = stat(cover.ymin, "min");
    const e = stat(cover.xmax, "max");
    const n = stat(cover.ymax, "max");
    return w !== undefined && s !== undefined && e !== undefined && n !== undefined ? [w, s, e, n] : undefined;
  });
}

/**
 * Whether reading by view can skip much of the file: it has a bbox covering
 * column, at least two row groups with its statistics, and those row groups
 * are spatially compact (sorted, e.g. by Hilbert curve) — each covering on
 * average at most half the file's extent. An unsorted file's row groups
 * each span nearly everything, so a view would still read almost all of it.
 * `band`: judged on an overview level's row groups instead of the canonical level's.
 */
export function canSkipByView(source: GeoParquetFile, band?: RowBand): boolean {
  const extents = rowGroupExtents(source, band);
  if (extents.length < 2 || extents.some((e) => !e)) return false;
  const boxes = extents as BBox[];
  const area = (b: BBox) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const whole: BBox = [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
  const total = area(whole);
  if (total <= 0) return false;
  const mean = boxes.reduce((sum, b) => sum + area(b), 0) / boxes.length;
  return mean <= total / 2;
}

// ---------------------------------------------------------------------------
// Codecs
// ---------------------------------------------------------------------------

/** Codec names hyparquet decodes itself or with the reader's chunk. */
const KNOWN_CODECS = new Set(["UNCOMPRESSED", "SNAPPY", "GZIP", "ZSTD", "LZ4", "LZ4_RAW", "BROTLI"]);

/**
 * The decompressors for the column chunks a read touches — brotli fetched
 * on demand. A codec this reader lacks (LZO) is refused in plain words.
 * `band`: the row groups read (default the canonical level, or every one).
 */
export async function compressorsFor(
  source: GeoParquetFile,
  columns: readonly string[],
  band?: RowBand
): Promise<Compressors> {
  const read = new Set(columns);
  const codecs = new Set<string>();
  for (const { group } of dataRowGroups(source, band)) {
    for (const chunk of group.columns) {
      const meta = chunk.meta_data;
      if (meta && read.has(meta.path_in_schema[0]!)) codecs.add(meta.codec);
    }
  }
  for (const codec of codecs) {
    if (KNOWN_CODECS.has(codec)) continue;
    throw host().formatError({
      code: "read",
      format: "geoparquet",
      url: source.url,
      detail: `it is compressed with ${codec}, which the browser reader doesn't support; write it with snappy or zstd compression`,
    });
  }
  if (!codecs.has("BROTLI")) return compressors;
  try {
    // Its own chunk, through the seam the main bundle holds (a copy of the
    // seam in this chunk would look for it under chunks/chunks/).
    const { decompressBrotli } = await host().getDecoder("geoparquet-brotli");
    return { ...compressors, BROTLI: decompressBrotli };
  } catch (error) {
    // Named for the format the author wrote, not the chunk's internal name.
    const failure = isFormatError(error) ? error.failure : undefined;
    throw host().formatError({
      code: "chunk",
      format: "geoparquet",
      url: failure?.url ?? "chunks/geoparquet-brotli.js",
      ...(failure?.detail ? { detail: failure.detail } : {}),
    });
  }
}

/** Options for {@link readAll} and {@link readBbox}. */
export interface ReadOptions {
  /** The attribute columns to read (`all`, or the projection). Default `all`. */
  columns?: ColumnChoice;
  /** Returns false once the read is superseded; the result is then `null`. */
  isCurrent?: () => boolean;
  /**
   * {@link readBbox} only: the rows to read — an overview level
   * ({@link overviewBand}) — instead of the canonical level. A whole-file
   * read ({@link readAll}) always reads the canonical level.
   */
  band?: RowBand;
}

/** Read rows (optionally filtered) as features. */
async function read(
  source: GeoParquetFile,
  options: ReadOptions,
  filter?: Record<string, unknown>
): Promise<FeatureCollection | null> {
  const columns = columnsToRead(source, options.columns ?? "all");
  // An overview file: the band's rows only — a level by view, else the
  // canonical level (hyparquet plans only the row groups in that range,
  // before any fetch).
  const band = options.band ?? source.info.overviews?.canonical;
  try {
    const compressors = await compressorsFor(
      source,
      [...columns, ...(filter && source.info.covering ? [source.info.covering.xmin.split(".")[0]!] : [])],
      band
    );
    if (options.isCurrent && !options.isCurrent()) return null;
    const rows = (await parquetReadObjects({
      file: source.file,
      metadata: source.metadata,
      columns,
      compressors,
      ...(band ? { rowStart: band.rowStart, rowEnd: band.rowEnd } : {}),
      ...(filter ? { filter: filter as never } : {}),
    })) as Obj[];
    if (options.isCurrent && !options.isCurrent()) return null;
    const data: FeatureCollection = {
      type: "FeatureCollection",
      features: toFeatures(rows, source.info.geometryColumn, columns),
    };
    // Every column the file has, read or not: what a hint suggests from.
    host().recordPropertyNames(data, source.info.columns);
    return data;
  } catch (error) {
    throw readFailure(error, source.url);
  }
}

/** Read every row (the projected columns; an overview file's canonical level) as features. */
export function readAll(source: GeoParquetFile, options: Omit<ReadOptions, "band"> = {}): Promise<FeatureCollection | null> {
  const { columns, isCurrent } = options;
  return read(source, { ...(columns ? { columns } : {}), ...(isCurrent ? { isCurrent } : {}) });
}

/**
 * Read only the features whose bbox intersects `bbox`: row groups whose
 * covering statistics lie outside it are never fetched, and the rows left
 * are filtered by their own bbox. `options.band` reads an overview level
 * instead of the canonical level.
 *
 * @throws A `no-index` {@link FormatError} when the file has no bbox covering column.
 */
export function readBbox(
  source: GeoParquetFile,
  bbox: BBox,
  options: ReadOptions = {}
): Promise<FeatureCollection | null> {
  const cover = source.info.covering;
  if (!cover) return Promise.reject(host().formatError({ code: "no-index", format: "geoparquet", url: source.url }));
  const [west, south, east, north] = bbox;
  return read(source, options, {
    $and: [
      { [cover.xmin]: { $lte: east } },
      { [cover.xmax]: { $gte: west } },
      { [cover.ymin]: { $lte: north } },
      { [cover.ymax]: { $gte: south } },
    ],
  });
}

/**
 * Decode a whole GeoParquet file already in memory (`mlym emit`, classify
 * breaks at export). Node-safe.
 *
 * @param bytes - The file.
 * @param url - Its name, for messages.
 */
export async function decodeBytes(
  bytes: Uint8Array,
  url: string,
  options: { columns?: ColumnChoice } = {}
): Promise<FeatureCollection> {
  const source = await openBytes(bytes, url);
  return (await readAll(source, { columns: options.columns ?? "all" }))!;
}

// ---------------------------------------------------------------------------
// The data provider (ml-cnv.4)
// ---------------------------------------------------------------------------

/**
 * A GeoParquet view is not read when the row groups it touches hold more than
 * this many times `maxFeatures` rows (M2 of the PR #206 review): a reader
 * decodes each row group it touches whole, so the per-view estimate (rows
 * actually in view) can be well under budget while the decode is not.
 *
 * @remarks
 * Measured on NYC PLUTO (856,687 parcels, Chromium on a desktop with a GPU,
 * 2026-10-24): with 100,000-row groups, a citywide view at zoom 12.5
 * estimated at about 145,000 features touched 600,000 rows — 3.8 GB of
 * renderer memory and 10 fps while panning — and a borough view at zoom 13
 * touched 556,687 rows (3.7 GB, 13 fps). The same views of the file in
 * 10,000-row groups touched 260,000 and 210,000 rows (2.9 GB at 25 fps,
 * 2.7 GB at 29 fps).
 *
 * How tightly 10,000-row groups pack depends on the sort (the 26 measured
 * views of 1280 × 800 px at zooms 12–14 that hold at most 150,000 features,
 * 2026-10-26): a Hilbert sort (GeoPandas or `gpio sort hilbert`) touches at
 * most 260,000 rows; GDAL's `SORT_BY_BBOX` up to 329,495 from a sorted input
 * and 449,120 from an unsorted one (379,394 at Brooklyn zoom 13). The
 * 100,000-row file touches 500,000–600,000 rows in the same views, except
 * close in. At 3 × the default 150,000 (450,000 rows) every view of every
 * 10,000-row file that fits the estimate is read — at 2.5 × a file sorted by
 * the hint's own command was refused — while the 100,000-row views of
 * 500,000 rows and more are not, and its block views (200,000–300,000 rows)
 * still are.
 */
export const VIEW_DECODE_FACTOR = 3;
/**
 * Row groups up to this many rows are small enough: a decode over budget is
 * then their packing (the sort), not their size.
 */
const SMALL_ROW_GROUP = 15_000;

/**
 * Read a whole GeoParquet file (the projected columns), with the size
 * guards, all from the footer before any data is read: the transfer (over
 * {@link WHOLE_FILE_WARN_BYTES} a console note), and what decoding costs —
 * the rows and the read columns' uncompressed size (ml-37r.16). Over
 * {@link WHOLE_FILE_MAX_BYTES}, {@link WHOLE_FILE_MAX_FEATURES} rows or
 * {@link WHOLE_FILE_MAX_DECODED_BYTES} decoded, nothing is read: a file that
 * can be read by view (bbox covering column, sorted row groups, range
 * requests) rejects with {@link WholeFileTooLarge} (the loader then reads by
 * view), any other is refused with a `too-large` notice.
 *
 * @param opened - The file, when the caller already opened it.
 * @returns The features (`null` when `isCurrent()` turned false mid-read)
 *   and the opened file.
 */
export async function loadGeoParquetWhole(
  url: string,
  columns: ColumnChoice,
  options: {
    isCurrent?: () => boolean;
    opened?: GeoParquetFile;
    limits?: SizeLimits;
    /** The footer read, already started (see {@link OpenOptions.started}). */
    started?: StartedTail;
  } = {}
): Promise<{ data: FeatureCollection | null; source: GeoParquetFile }> {
  const limits = host().sizeLimits(options.limits);
  const source =
    options.opened ??
    (await open(url, { maxWholeBytes: limits.max, ...(options.started ? { started: options.started } : {}) }));
  const tooLarge = geoParquetTooLarge(source, columns, limits);
  if (tooLarge) {
    const blocker = byViewBlocker(source);
    if (!blocker) throw tooLarge;
    throw host().formatError({
      code: "too-large",
      format: "geoparquet",
      url,
      ...tooLarge.cost,
      blocker,
    });
  }
  const [size] = projectedSize(source, columns);
  if (size > limits.warn) {
    // What reading by view would take, from the footer (ml-cnv.35): nothing
    // when the file is ready for it, the sort when it isn't, and nothing at
    // all from a host without range requests (its own note follows).
    const blocker = byViewBlocker(source);
    const byView =
      blocker === "no-range"
        ? ""
        : blocker
          ? `To read only the part in view, sort it (${host().messages.sortedParquetCommand(url)}) and add \`load: viewport\`; or `
          : "To read only the part in view, add `load: viewport` (it has a `bbox` column and sorted row groups); or ";
    console.warn(
      "[maplibre-yaml] " +
        host().consoleText(
        `${url}: the columns this map reads are ${mb(size)}; loading them whole may take a few seconds. ` +
          `${byView}list fewer \`columns:\`; or, to draw it at every zoom, convert it to PMTiles. ` +
          host().messages.largeDataLinks("geoparquet")
      )
    );
  }
  if (!source.ranges && source.byteLength > TAIL_BYTES) {
    console.warn(noRangeNote(url, "the whole file was downloaded, not just the columns this map reads"));
  }
  const data = await readAll(source, {
    columns,
    ...(options.isCurrent ? { isCurrent: options.isCurrent } : {}),
  });
  return { data, source };
}

/**
 * Whether a GeoParquet file is over the whole-file limits (rows, decoded
 * bytes of the read columns, compressed bytes transferred), from its footer
 * alone: the {@link WholeFileTooLarge} to throw (carrying the opened file
 * and what it costs), or undefined when it can be read whole.
 */
function geoParquetTooLarge(
  source: GeoParquetFile,
  columns: ColumnChoice,
  limits: Required<SizeLimits>
): WholeFileTooLarge | undefined {
  const [size, decoded] = projectedSize(source, columns);
  const rows = source.info.rows;
  if (size <= limits.max && rows <= limits.maxFeatures && decoded <= limits.maxDecoded) return undefined;
  const features = rows > limits.maxFeatures || decoded > limits.maxDecoded ? rows : undefined;
  return new (host().WholeFileTooLarge)(size, source, features, {
    size,
    features: rows,
    decoded,
    limits: costLimits(limits),
  });
}

/** Why a GeoParquet file can't be read by view, or undefined when it can. */
function byViewBlocker(source: GeoParquetFile): "no-bbox" | "unsorted" | "no-range" | undefined {
  if (!source.info.covering) return "no-bbox";
  if (!canSkipByView(source)) return "unsorted";
  if (!source.ranges) return "no-range";
  return undefined;
}

/**
 * Reads one GeoParquet source into its GeoJSON data — the data provider the
 * GeoJSON `url:` pipeline calls instead of its JSON fetch. Mirrors
 * {@link FlatGeobufLoader}.
 *
 * @remarks
 * `load: all` (default): the footer, then the projected columns of every
 * row group. Size guards as in {@link loadGeoParquetWhole}.
 *
 * `load: viewport`: only the rows whose bbox intersects the view — row
 * groups outside it are never fetched (GeoParquet 1.1 `bbox` covering
 * statistics) — see {@link ViewLoader}; a view's rows are estimated from the
 * same statistics before reading. A file that can't skip anything by view
 * (no covering column: a notice; unsorted row groups, or a server without
 * range requests: a console note) is read whole instead, under the same
 * size guards.
 */
export class GeoParquetLoader extends ViewLoader<StartedTail> {
  protected readonly format = "geoparquet" as const;
  private opened: GeoParquetFile | undefined;

  constructor(
    map: MapLibreMap,
    url: string,
    load: LoadMode,
    private readonly columns: ColumnChoice,
    callbacks: FlatGeobufCallbacks,
    limits?: SizeLimits
  ) {
    super(map, url, load, callbacks, host().sizeLimits(limits, load));
  }

  private overviewsNoted = false;
  /**
   * The overview level the last read by view delivered (its index;
   * undefined for a file read without levels), or null before the first.
   */
  private level: number | undefined | null = null;

  /**
   * An overview file whose `geo:overviews` major version this version
   * doesn't know: its full-detail level is read, and the author told (once).
   */
  private noteOverviews(source: GeoParquetFile | undefined): void {
    const overviews = source?.info.overviews;
    if (!overviews || overviews.known || this.overviewsNoted) return;
    this.overviewsNoted = true;
    this.hint(
      `\`${this.url}\` has overviews in a newer format (geo:overviews ${overviews.version || "?"}) than this ` +
        `version of maplibre-yaml reads: ${overviews.canonical ? "drawing its full-detail level only" : "reading every row"}. ` +
        "Update maplibre-yaml, or write the file without overviews.",
      "overviews"
    );
  }

  /**
   * The rows a read by view at map zoom `zoom` takes: the overview level for
   * it (`load.overviews`, a known major version; {@link overviewBand}), else
   * undefined — the canonical level, or every row.
   */
  private bandAt(zoom: number): OverviewBand | undefined {
    return this.load.overviews ? overviewBand(this.opened?.info.overviews, zoom) : undefined;
  }

  /** Whether reads by view choose an overview level by zoom (every level has one). */
  private get levels(): boolean {
    const band = this.bandAt(0);
    return band !== undefined && !band.fallback;
  }

  /**
   * An overview file read by level with no author `minzoom`: 0, so its
   * coarsest level serves the widest views (KTD4); an author `minzoom` wins.
   */
  get minzoom(): number {
    return this.load.authorMinzoom === undefined && this.levels ? 0 : this.load.minzoom;
  }

  /** A level without a zoom (neither `zoom` nor `gsd`): the levels can't be chosen; the author told once. */
  private noteNoZoom(): void {
    const overviews = this.opened?.info.overviews;
    if (!overviews || this.bandAt(0)?.fallback !== "no-zoom") return;
    const missing = overviews.levels.findIndex((level) => levelZoom(level) === undefined);
    this.hint(
      `\`${this.url}\` has overviews, but its level ${missing} declares neither \`zoom\` nor \`gsd\`, so the ` +
        `level for a zoom can't be chosen: drawing it at full detail only, from zoom ${this.minzoom}. Rebuild the ` +
        "overviews with a zoom on every level (tylertoo writes one), or add `overviews: false` under `load:` to say so.",
      "no-zoom"
    );
  }

  /** The file's extent from its GeoParquet metadata — what `fitTo` frames when read by view. */
  get extent(): [[number, number], [number, number]] | undefined {
    const bbox = this.opened?.info.bbox;
    return bbox ? [[bbox[0], bbox[1]], [bbox[2], bbox[3]]] : undefined;
  }

  /**
   * The whole-file read — or, when the host already started it (the `fitTo`
   * prefetch, through {@link loadGeoParquetWhole}), its result.
   */
  protected async readWhole(started?: Promise<FeatureCollection>): Promise<void> {
    const generation = ++this.generation;
    let data: FeatureCollection | null;
    try {
      if (started) {
        data = await started;
      } else {
        const opening = this.opened ? undefined : this.takeOpening();
        const read = await loadGeoParquetWhole(this.url, this.columns, {
          isCurrent: () => generation === this.generation && !this.destroyed,
          limits: this.limits,
          ...(this.opened ? { opened: this.opened } : {}),
          ...(opening ? { started: opening } : {}),
        });
        this.opened = read.source;
        this.noteOverviews(read.source);
        data = read.data;
      }
    } catch (error) {
      if (!(error instanceof host().WholeFileTooLarge)) throw error;
      this.opened ??= error.opened as GeoParquetFile | undefined;
      await this.startViewport(true, error);
      return;
    }
    this.deliver(data);
  }

  /**
   * Switch to reading by view: open the file (its footer says whether it has
   * a bbox covering column and how its row groups are laid out), then follow
   * the map.
   *
   * @param auto - true when a too-large whole-file read switched here.
   */
  protected async startViewport(auto: boolean, tooLarge?: WholeFileTooLarge): Promise<void> {
    if (!this.opened) {
      const opening = this.takeOpening();
      this.opened = await open(this.url, { maxWholeBytes: this.limits.max, ...(opening ? { started: opening } : {}) });
    }
    const source = this.opened;
    this.noteOverviews(source);
    const blocker = byViewBlocker(source);
    if (blocker) {
      // Can't be read by view. Whole, then — unless that is too large too,
      // when the refusal names what blocks the by-view read (not "add
      // `load: viewport`", which the source may already say; ml-cnv.33),
      // before anything is said about reading it whole.
      const whole = tooLarge ?? geoParquetTooLarge(source, this.columns, this.limits);
      if (whole) {
        throw host().formatError({
          code: "too-large",
          format: "geoparquet",
          url: this.url,
          ...whole.cost,
          blocker,
        });
      }
      if (blocker === "no-bbox") throw host().formatError({ code: "no-index", format: "geoparquet", url: this.url });
      console.warn(
        blocker === "no-range"
          ? noRangeNote(this.url, "`load: viewport` reads the whole file instead")
          : "[maplibre-yaml] " +
              host().consoleText(
                `${this.url} isn't spatially sorted (each row group spans most of the file), so reading by view ` +
                  `would read almost all of it: reading it whole instead. Sort it to make \`load: viewport\` pay ` +
                  `off: ${host().messages.sortedParquetCommand(this.url)}.`
              )
      );
      await this.readWhole();
      return;
    }
    if (this.destroyed) return;
    if (auto) this.autoNote(tooLarge);
    this.noteNoZoom();
    await this.follow();
  }

  /**
   * The row groups in view (of the level for `zoom`, on an overview file),
   * each counting its rows by the share of it in view.
   */
  protected estimate(view: BBox, zoom: number): number {
    return this.opened ? rowsInView(this.opened, view, this.bandAt(zoom)) : 0;
  }

  /**
   * An overview file whose level for this zoom is still over `maxFeatures`
   * (KTD6): no coarser level is drawn instead, so the hint says what the
   * coarsest one holds here and how to rebuild the file.
   */
  protected denseHint(view: BBox, estimate: number, zoom: number): string | undefined {
    const band = this.bandAt(zoom);
    const overviews = this.opened?.info.overviews;
    if (!band || band.fallback || !overviews) return undefined;
    const n = host().messages.formatCount;
    const zoomOf = (index: number) => Math.round(levelZoom(overviews.levels[index]!)!);
    const coarsest = overviewBand(overviews, 0)!;
    const lowest = zoomOf(coarsest.level);
    // A map below every level: levels from its zoom too.
    const from = Math.max(0, Math.min(Math.floor(zoom), lowest));
    const to = zoomOf(overviews.canonicalLevel ?? overviews.levels.length - 1);
    const stem = host().messages.commandStem(this.url, "parquet");
    const raise = roundedRaise(estimate);
    return (
      `\`${this.url}\` is an overview file, and its zoom-${zoomOf(band.level)} level` +
      (band.level === coarsest.level ? ", its coarsest," : "") +
      ` still has about ${n(estimate)} features in view, more than one read takes ` +
      `(\`maxFeatures\`: ${n(this.load.maxFeatures)}), so nothing of it is drawn until the map is zoomed in` +
      (band.level === coarsest.level
        ? ". "
        : `; a coarser level isn't drawn instead (its coarsest, zoom ${lowest}, has about ${n(Math.round(rowsInView(this.opened!, view, coarsest)))} here). `) +
      "To draw this view, rebuild the overviews from the data they were made from (`source.parquet` here) with fewer " +
      "features per level — a higher `drop_rate` (tylertoo's default is 1.65)" +
      (from < lowest ? `, and levels from zoom ${from}` : "") +
      `: \`uv run --with tylertoo==0.8.0 python -c "import tylertoo as t; t.overview('source.parquet', ` +
      `'${stem}.parquet', min_zoom=${from}, max_zoom=${to}, drop_rate=2.5)"\`. ` +
      (raise <= SAFE_VIEW_FEATURES
        ? `Or raise \`maxFeatures\` to ${raise} under \`load:\` (${host().messages.raiseCost(raise, true)}). `
        : "") +
      `To draw it at every zoom, convert it to PMTiles: ${host().messages.pmtilesCommand(this.url, "geoparquet")}. ` +
      host().messages.largeDataLinks("geoparquet")
    );
  }

  /**
   * Whether the row groups `view` touches hold more rows than
   * {@link VIEW_DECODE_FACTOR} × `maxFeatures`: each is decoded whole, so
   * large row groups cost far more than the features in view.
   */
  protected decodeTooCostly(view: BBox, estimate: number, zoom: number): string | undefined {
    if (!this.opened) return undefined;
    const touched = rowGroupsInView(this.opened, view, this.bandAt(zoom));
    const budget = Math.round(this.load.maxFeatures * VIEW_DECODE_FACTOR);
    if (touched.rows <= budget) return undefined;
    const n = host().messages.formatCount;
    // A raise only when the author lowered maxFeatures below the default:
    // the default's decode limit is already the most a view should decode.
    const raise = roundedRaise(touched.rows / VIEW_DECODE_FACTOR);
    const offer = touched.rows <= VIEWPORT_DEFAULT_MAX_FEATURES * VIEW_DECODE_FACTOR;
    // What to rewrite, if anything (PR #206 verification): large row groups
    // → 10,000-row groups; small ones loosely packed (GDAL's SORT_BY_BBOX
    // packs 1.5–2 × looser than a Hilbert sort) → a Hilbert sort; a file
    // already Hilbert-sorted by the hint's own command → nothing to rewrite.
    const stem = host().messages.commandStem(this.url, "parquet");
    const rewrite =
      touched.largest > SMALL_ROW_GROUP
        ? `To fix it, rewrite the file with about 10,000-row groups, sorted along a Hilbert curve: ${host().messages.sortedParquetCommand(this.url)}. `
        : /-hilbert$/.test(stem)
          ? ""
          : "Its row groups are already small, but loosely packed (each spans a wide area): sort it along a Hilbert " +
            `curve, which packs nearby rows tightly: ${host().messages.sortedParquetCommand(this.url)}. `;
    return (
      `\`${this.url}\` has row groups of up to ${n(touched.largest)} rows, and each row group a view touches ` +
      `is decoded whole: this view holds about ${n(estimate)} features but touches ${touched.groups} row group${touched.groups === 1 ? "" : "s"}, ` +
      `${n(touched.rows)} rows, over this map's decode limit of ${n(budget)} rows (${VIEW_DECODE_FACTOR} × \`maxFeatures\`), ` +
      "so nothing is read until the map is zoomed in. " +
      rewrite +
      `To draw it at every zoom (a citywide view too), convert it to PMTiles: ${host().messages.pmtilesCommand(this.url, "geoparquet")}. ` +
      (offer ? `Or raise \`maxFeatures\` to ${raise} under \`load:\` (${host().messages.raiseCost(raise, true)}). ` : "") +
      host().messages.largeDataLinks("geoparquet")
    );
  }

  /**
   * Read the rows in view of the level for `zoom`. Moving to another level
   * than the last read's tells the host first (`onLevelChange`: feature ids
   * are unique only within a level); a read superseded meanwhile — the map
   * zoomed on across another boundary — never lands.
   */
  protected async readView(view: BBox, isCurrent: () => boolean, zoom: number): Promise<FeatureCollection | null> {
    const band = this.bandAt(zoom);
    const data = await readBbox(this.opened!, view, { columns: this.columns, isCurrent, ...(band ? { band } : {}) });
    if (!data || !isCurrent()) return null;
    if (this.level !== null && band?.level !== this.level) this.callbacks.onLevelChange?.();
    this.level = band?.level;
    return data;
  }
}
