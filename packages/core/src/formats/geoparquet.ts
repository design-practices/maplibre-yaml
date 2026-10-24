/**
 * @file GeoParquet: read a `.parquet` file into GeoJSON features (0.9, ml-cnv.4)
 * @module @maplibre-yaml/core/formats/geoparquet
 *
 * @description
 * GeoParquet is a columnar feature file. Core reads it into an ordinary
 * MapLibre GeoJSON source, so layers, popups, legend, `fitTo` and
 * clustering behave exactly as for a `.geojson` file.
 *
 * **The library is downloaded on demand** (`chunks/geoparquet.js`, and
 * `chunks/geoparquet-brotli.js` for a brotli file, through
 * formats/decoders): this module stays in the main bundle and fetches it the
 * first time a file is opened. A download failure is a {@link FormatError}
 * of code `"chunk"`.
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
 *   its chunk; brotli (a large decoder) is its own chunk, loaded only when
 *   the file's footer says a column chunk uses it.
 * - **Encodings and CRS**: WKB geometry only (GeoArrow-native encodings are
 *   refused with how to rewrite the file); longitude/latitude only (the
 *   shared rule in ./crs).
 *
 * Every failure becomes a {@link FormatError} with a plain-language message,
 * except an HTTP error status, which is thrown in the shape the GeoJSON
 * fetcher uses (`HTTP 404: Not Found for <url>`) so the notice words a
 * missing `.parquet` exactly like a missing `.geojson` (with the same `base`
 * advice).
 */

// Types only: a value import would pull the library into the main bundle.
import type { AsyncBuffer, Compressors, FileMetaData, LogicalType } from "hyparquet";
import type { FeatureCollection } from "geojson";
import { isLonLatCrs } from "./crs";
import { getDecoder } from "./decoders";
import { recordPropertyNames } from "../data/property-names";
import { FormatError, isAbortError, isFormatError } from "./errors";
import {
  BodyTooLarge,
  fetchTail,
  fetchWhole,
  httpError,
  isEncodedRange,
  rangeRepliesUnreadable,
  type Tail,
} from "./http";

/** The first read: the file's last 512 KiB — the footer, and all of a small file. */
export const TAIL_BYTES = 512 * 1024;

/** `[west, south, east, north]`. */
export type BBox = [number, number, number, number];

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
 * A GeoParquet overview file's levels (`geo:overviews`, draft spec 0.2.0,
 * written by tylertoo): each zoom level is a run of row groups, coarse to
 * fine. In `duplicating` mode each level is a complete copy of the data, so
 * a reader that reads every row draws each feature once per level (2,201
 * features for 601 parcels in the spike, ml-cnv.21); core reads only the
 * canonical — full-detail — level. Choosing a coarser level by zoom is 0.10
 * (ml-cnv.22). In `partitioning` mode each feature appears once: every row
 * is the data.
 */
export interface Overviews {
  /** The key's `version`, e.g. "0.2.0". */
  version: string;
  mode: "duplicating" | "partitioning";
  /** How many levels the file has. */
  levels: number;
  /** Whether this version knows the key's major version (0). */
  known: boolean;
  /**
   * The canonical level's rows and row groups (`duplicating` mode):
   * groups `groupStart`..`groupEnd` (inclusive), rows `rowStart`..`rowEnd`
   * (exclusive) — what every read and size check is restricted to.
   */
  canonical?: { groupStart: number; groupEnd: number; rowStart: number; rowEnd: number };
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

/** The columns to read: a list (projection) or every column. */
export type ColumnChoice = readonly string[] | "all";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The plain-language error for what `fetch` threw. */
function fetchFailure(error: unknown, url: string): unknown {
  if (isAbortError(error)) return error;
  return new FormatError({ code: "cors", format: "geoparquet", url });
}

/** Map what the library threw while reading to a classified error. */
function readFailure(error: unknown, url: string): unknown {
  if (isAbortError(error) || isFormatError(error)) return error;
  const e = error as { message?: unknown; status?: unknown } | null;
  if (typeof e?.status === "number") return error; // our own HTTP shape, from a range read
  const message = String(e?.message ?? error);
  if (/footer != PAR1|metadata length|parquet file invalid|unexpected end|out of bounds|outside the bounds/i.test(message)) {
    return new FormatError({ code: "not-format", format: "geoparquet", url });
  }
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return new FormatError({ code: "cors", format: "geoparquet", url });
  }
  return new FormatError({ code: "read", format: "geoparquet", url, detail: message });
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
      if (!ranges) throw new FormatError({ code: "no-range", format: "geoparquet", url });
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { Range: `bytes=${start}-${end - 1}` },
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        throw fetchFailure(error, url);
      }
      if (!response.ok) throw httpError(response, url);
      if (response.status !== 206) {
        void response.body?.cancel().catch(() => undefined);
        throw new FormatError({ code: "no-range", format: "geoparquet", url });
      }
      if (isEncodedRange(response)) {
        void response.body?.cancel().catch(() => undefined);
        throw new FormatError({ code: "encoded-range", format: "geoparquet", url });
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
  // The reader downloads while the footer request is in flight.
  const library = getDecoder("geoparquet");
  library.catch(() => undefined);
  let tail: Tail;
  try {
    tail = await fetchTail(url, tailBytes, {
      ...(signal ? { signal } : {}),
      ...(options.maxWholeBytes !== undefined ? { maxWholeBytes: options.maxWholeBytes } : {}),
    });
  } catch (error) {
    if (error instanceof BodyTooLarge) {
      // A whole file over the guard: from a server without ranges, the
      // hosting is what to fix; otherwise the file is simply too big to
      // read whole (a host that hid its size from this page).
      const code = error.ranges === false ? "no-range" : "too-large";
      throw new FormatError({ code, format: "geoparquet", url, size: error.size });
    }
    if (typeof (error as { status?: unknown } | null)?.status === "number") throw error;
    throw fetchFailure(error, url);
  }

  const looksRight = (t: Tail) => {
    const b = new Uint8Array(t.bytes);
    return b.length >= 12 && hasMagic(b, b.length - 4) && (t.start !== 0 || hasMagic(b, 0));
  };
  if (!looksRight(tail) && tail.ranges && (await rangeRepliesUnreadable(url))) {
    // A host that answers ranges from a compressed copy (jsDelivr's
    // Cloudflare leg): the whole file, which the browser decodes, is right.
    try {
      tail = await fetchWhole(url, {
        ...(signal ? { signal } : {}),
        ...(options.maxWholeBytes !== undefined ? { maxWholeBytes: options.maxWholeBytes } : {}),
      });
    } catch (error) {
      if (error instanceof BodyTooLarge) {
        throw new FormatError({ code: "encoded-range", format: "geoparquet", url });
      }
      if (typeof (error as { status?: unknown } | null)?.status === "number") throw error;
      throw fetchFailure(error, url);
    }
  }
  if (!looksRight(tail)) throw new FormatError({ code: "not-format", format: "geoparquet", url });
  const held = { start: tail.start, bytes: tail.bytes };
  const file = rangeReader(url, tail.size, held, tail.ranges, signal);
  const { parquetMetadataAsync } = await library;
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
    throw new FormatError({ code: "not-format", format: "geoparquet", url });
  }
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const file = rangeReader(url, buffer.byteLength, { start: 0, bytes: buffer }, false);
  const { parquetMetadataAsync } = await getDecoder("geoparquet");
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

/**
 * Read the GeoParquet facts from a parsed footer, and refuse what this
 * version can't draw.
 */
/**
 * The `geo:overviews` key (or its planned home, `geo.overviews`), read into
 * {@link Overviews}; undefined when the file has none, or one whose levels
 * don't tile the row groups (then it is read as plain GeoParquet).
 */
function parseOverviews(metadata: FileMetaData, geo: Obj | undefined): Overviews | undefined {
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
  // Each level ends at a row group (inclusive); together they cover every group, in order.
  const ends: number[] = [];
  for (const level of levels) {
    const end = isObject(level) ? Number(level["row_group_end"]) : NaN;
    if (!Number.isInteger(end) || end < (ends.at(-1) ?? -1) + 1 || end >= groups.length) return undefined;
    ends.push(end);
  }
  if (ends.at(-1) !== groups.length - 1) return undefined;
  const overviews: Overviews = { version, mode, levels: ends.length, known: version.split(".")[0] === "0" };
  if (mode === "duplicating") {
    const declared = raw["canonical_level"];
    const index = typeof declared === "number" && Number.isInteger(declared) && declared >= 0 && declared < ends.length
      ? declared
      : ends.length - 1;
    const groupStart = index === 0 ? 0 : ends[index - 1]! + 1;
    const groupEnd = ends[index]!;
    let rowStart = 0;
    for (let i = 0; i < groupStart; i++) rowStart += Number(groups[i]!.num_rows);
    let rowEnd = rowStart;
    for (let i = groupStart; i <= groupEnd; i++) rowEnd += Number(groups[i]!.num_rows);
    overviews.canonical = { groupStart, groupEnd, rowStart, rowEnd };
  }
  return overviews;
}

/**
 * The row groups that hold the file's data, with their indexes: every one,
 * or an overview file's canonical level (ml-cnv.21).
 */
export function dataRowGroups(source: GeoParquetFile): { group: FileMetaData["row_groups"][number]; index: number }[] {
  const band = source.info.overviews?.canonical;
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

export function geoInfo(metadata: FileMetaData, url: string): GeoParquetInfo {
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
    if (!native) throw new FormatError({ code: "not-geoparquet", format: "geoparquet", url });
    geometryColumn = native.name;
    const crs = (native.logical_type as { crs?: unknown }).crs;
    column = { encoding: "WKB", ...(crs !== undefined ? { crs } : {}) };
  }

  const encoding = String(column["encoding"] ?? "WKB");
  if (encoding.toUpperCase() !== "WKB") {
    throw new FormatError({ code: "encoding", format: "geoparquet", url, encoding });
  }

  const bbox = toBBox(column["bbox"]);
  // `crs` absent means OGC:CRS84 (the spec's default); `null` means unknown.
  const facts = "crs" in column ? crsFacts(column["crs"]) : { org: "OGC", code: "CRS84" };
  const lonLat = !facts.projected && isLonLatCrs({ org: facts.org, code: facts.code, envelope: bbox });
  if (!lonLat) {
    throw new FormatError({
      code: "crs",
      format: "geoparquet",
      url,
      ...(facts.name ? { crs: facts.name } : {}),
    });
  }

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

  return {
    geometryColumn: geometryColumn!,
    ...(facts.name ? { crs: facts.name } : {}),
    ...(bbox ? { bbox } : {}),
    ...(coveringPaths ? { covering: coveringPaths } : {}),
    columns: topColumns.filter((name) => name !== geometryColumn && name !== coveringColumn),
    rowGroups: band ? band.groupEnd - band.groupStart + 1 : metadata.row_groups.length,
    rows: band ? band.rowEnd - band.rowStart : Number(metadata.num_rows),
    ...(overviews ? { overviews } : {}),
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
 * 47 MB on the wire can be several times that once decompressed).
 */
export function projectedSize(source: GeoParquetFile, columns: ColumnChoice): [number, number] {
  const read = new Set(columnsToRead(source, columns));
  let total = 0;
  let decoded = 0;
  for (const { group } of dataRowGroups(source)) {
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
 * The share of `box` that `view` covers, by area (0–1). A box with no area
 * (one point, a straight line) counts whole when the view touches it.
 */
export function shareInView(box: BBox, view: BBox): number {
  const w = Math.min(box[2], view[2]) - Math.max(box[0], view[0]);
  const h = Math.min(box[3], view[3]) - Math.max(box[1], view[1]);
  if (w < 0 || h < 0) return 0;
  const area = (box[2] - box[0]) * (box[3] - box[1]);
  return area > 0 ? (w * h) / area : 1;
}

/**
 * About how many rows a read of `view` returns, from the footer alone: each
 * row group's rows times the share of its covering extent the view covers
 * (rows spread evenly within a group, which is what spatially sorted groups
 * make roughly true). A group without statistics counts whole.
 */
export function rowsInView(source: GeoParquetFile, view: BBox): number {
  const extents = rowGroupExtents(source);
  let rows = 0;
  dataRowGroups(source).forEach(({ group }, i) => {
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
 */
export function rowGroupsInView(source: GeoParquetFile, view: BBox): { groups: number; rows: number; largest: number } {
  const extents = rowGroupExtents(source);
  let groups = 0;
  let rows = 0;
  let largest = 0;
  dataRowGroups(source).forEach(({ group }, i) => {
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
 * without stats), in {@link dataRowGroups} order.
 */
function rowGroupExtents(source: GeoParquetFile): (BBox | undefined)[] {
  const cover = source.info.covering;
  if (!cover) return [];
  return dataRowGroups(source).map(({ group }) => {
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
 */
export function canSkipByView(source: GeoParquetFile): boolean {
  const extents = rowGroupExtents(source);
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
 */
export async function compressorsFor(source: GeoParquetFile, columns: readonly string[]): Promise<Compressors> {
  const { compressors } = await getDecoder("geoparquet");
  const read = new Set(columns);
  const codecs = new Set<string>();
  for (const { group } of dataRowGroups(source)) {
    for (const chunk of group.columns) {
      const meta = chunk.meta_data;
      if (meta && read.has(meta.path_in_schema[0]!)) codecs.add(meta.codec);
    }
  }
  for (const codec of codecs) {
    if (KNOWN_CODECS.has(codec)) continue;
    throw new FormatError({
      code: "read",
      format: "geoparquet",
      url: source.url,
      detail: `it is compressed with ${codec}, which the browser reader doesn't support; write it with snappy or zstd compression`,
    });
  }
  if (!codecs.has("BROTLI")) return compressors;
  try {
    const { decompressBrotli } = await getDecoder("geoparquet-brotli");
    return { ...compressors, BROTLI: decompressBrotli };
  } catch (error) {
    // Named for the format the author wrote, not the chunk's internal name.
    const failure = isFormatError(error) ? error.failure : undefined;
    throw new FormatError({
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
}

/** Read rows (optionally filtered) as features. */
async function read(
  source: GeoParquetFile,
  options: ReadOptions,
  filter?: Record<string, unknown>
): Promise<FeatureCollection | null> {
  const columns = columnsToRead(source, options.columns ?? "all");
  try {
    const compressors = await compressorsFor(source, [
      ...columns,
      ...(filter && source.info.covering ? [source.info.covering.xmin.split(".")[0]!] : []),
    ]);
    if (options.isCurrent && !options.isCurrent()) return null;
    const { parquetReadObjects, toFeatures } = await getDecoder("geoparquet");
    // An overview file: its canonical level's rows only (hyparquet plans
    // only the row groups in that range, before any fetch).
    const band = source.info.overviews?.canonical;
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
    recordPropertyNames(data, source.info.columns);
    return data;
  } catch (error) {
    throw readFailure(error, source.url);
  }
}

/** Read every row (the projected columns) as features. */
export function readAll(source: GeoParquetFile, options: ReadOptions = {}): Promise<FeatureCollection | null> {
  return read(source, options);
}

/**
 * Read only the features whose bbox intersects `bbox`: row groups whose
 * covering statistics lie outside it are never fetched, and the rows left
 * are filtered by their own bbox.
 *
 * @throws A `no-index` {@link FormatError} when the file has no bbox covering column.
 */
export function readBbox(
  source: GeoParquetFile,
  bbox: BBox,
  options: ReadOptions = {}
): Promise<FeatureCollection | null> {
  const cover = source.info.covering;
  if (!cover) return Promise.reject(new FormatError({ code: "no-index", format: "geoparquet", url: source.url }));
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
