/**
 * @file FlatGeobuf, as the `flatgeobuf` on-demand chunk sees it: the library, the adapter and the data provider (0.9, ml-cnv.3; bundle headroom U5)
 * @module @maplibre-yaml/core/formats/lib/flatgeobuf
 *
 * @description
 * FlatGeobuf is a binary feature file with an optional spatial index. Core
 * reads it into an ordinary MapLibre GeoJSON source, so layers, popups,
 * legend, `fitTo` and clustering behave exactly as for a `.geojson` file.
 *
 * Two reads, matching the source's `load:`:
 *
 * - **whole file** (`openWhole` in formats/flatgeobuf + {@link decodeStream}):
 *   one streamed `GET`. Needs no range support — works on any static host.
 * - **part of it** ({@link probe} + {@link readBbox}): only the features in a
 *   bounding box, through the file's packed R-tree, with HTTP range requests.
 *
 * And its facts ({@link headerFacts}, large data round 2 U6): what
 * `mlym prepare` reports, from the header alone, through any `AsyncBuffer` —
 * naming a projected CRS instead of refusing it. Node-safe.
 *
 * Every failure becomes a `FormatError` with a plain-language message,
 * except an HTTP error status, which is thrown in the shape the GeoJSON
 * fetcher uses (`HTTP 404: Not Found for <url>`) so the on-page notice words
 * a missing `.fgb` exactly like a missing `.geojson` (with the same `base`
 * advice).
 *
 * **All of it is downloaded on demand** (`chunks/flatgeobuf.js`, through the
 * seam, formats/decoders): a page with no FlatGeobuf source never loads it.
 * The main bundle keeps only the whole-file `GET` (formats/flatgeobuf), which
 * it starts while this chunk downloads, and hands over. What this module
 * needs from core comes through the host ({@link useHost}, see
 * ./cloud-reader); it imports core as types only.
 *
 * Only what the adapter uses of the library: re-exporting the whole
 * `flatgeobuf/geojson` module would ship its writer (`serialize`) in the
 * chunk too. Its `dist/esm` build carries no `console.debug` range chatter
 * (the `lib/mjs` build does), which is why this imports the
 * `flatgeobuf/geojson` export.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";
import { deserialize } from "flatgeobuf/geojson";
import type { FormatError } from "../errors";
import type { LoadMode } from "../detect";
import type { OpenedFile } from "../flatgeobuf";
import type { FlatGeobufCallbacks, SizeLimits, StartedOpen } from "../../renderer/cloud-host";
import type { WholeFileTooLarge } from "../../renderer/cloud-sources";
import { isLonLatCrs } from "../crs";
import {
  costLimits,
  host,
  isAbortError,
  isFormatError,
  mb,
  noRangeNote,
  shareInView,
  ViewLoader,
  type AsyncBuffer,
  type BBox,
} from "./cloud-reader";

export { deserialize };
export { useHost, viewAround, VIEWPORT_DEBOUNCE_MS } from "./cloud-reader";

// ---------------------------------------------------------------------------
// The spatial index, one level of it
// ---------------------------------------------------------------------------

/** About how many features of the file a view holds: what {@link readIndexLevel} returns. */
export type FeaturesInView = (view: BBox) => number;

/** The bytes `[start, start + length)` of `url`, by range request (a 206, or it throws). */
async function range(url: string, start: number, length: number): Promise<ArrayBuffer> {
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${start + length - 1}` } });
  if (response.status !== 206) throw new Error(`range request: ${response.status}`);
  return response.arrayBuffer();
}

/**
 * Estimate how many features a view holds before reading any of them
 * (ml-37r.17), from the highest level of a FlatGeobuf file's spatial index
 * that still has at most 4,096 nodes — at most 160 KB, read once, after the
 * 4-byte header length. Each node covers a known run of features (the last
 * may cover fewer); a view counts each node's features by the share of the
 * node's box it covers, which a Hilbert-packed tree keeps compact. The
 * layout is the packed R-tree the library reads: levels stored root first,
 * 40 bytes per node (four doubles, then an offset).
 *
 * @param count - The header's `featuresCount`.
 * @param nodeSize - The header's `indexNodeSize`.
 */
async function indexLevel(url: string, count: number, nodeSize: number): Promise<FeaturesInView> {
  // No features, nothing in any view (and no tree to read). The node size is
  // clamped as the library's calcTreeSize does: 1 would loop forever (each
  // level as large as the last), past 65,535 isn't what the library reads
  // (ml-cnv.31). The loop is capped too: a valid tree has at most
  // log2(2^53) levels.
  if (!Number.isFinite(count) || count < 1) return () => 0;
  nodeSize = Math.min(Math.max(Math.floor(nodeSize) || 0, 2), 65535);
  const treeStart = 12 + new DataView(await range(url, 8, 4)).getUint32(0, true);
  // Nodes per level, leaves first (as the library's generateLevelBounds).
  const sizes = [count];
  let n = count;
  do {
    n = Math.ceil(n / nodeSize);
    sizes.push(n);
  } while (n > 1 && sizes.length < 64);
  let level = 0;
  while (sizes[level]! > 4096) level++;
  let before = 0;
  for (let i = level + 1; i < sizes.length; i++) before += sizes[i]!;
  const nodes = sizes[level]!;
  const span = nodeSize ** level;
  const bytes = new DataView(await range(url, treeStart + before * 40, nodes * 40));
  const box = (i: number, k: number) => bytes.getFloat64(i * 40 + k * 8, true);
  return (view) => {
    let features = 0;
    for (let i = 0; i < nodes; i++) {
      const w = Math.min(box(i, 2), view[2]) - Math.max(box(i, 0), view[0]);
      const h = Math.min(box(i, 3), view[3]) - Math.max(box(i, 1), view[1]);
      if (w < 0 || h < 0) continue;
      const area = (box(i, 2) - box(i, 0)) * (box(i, 3) - box(i, 1));
      features += (area > 0 ? (w * h) / area : 1) * Math.min(span, count - i * span);
    }
    return features;
  };
}

// ---------------------------------------------------------------------------
// The adapter: reading a file
// ---------------------------------------------------------------------------

/** What the file's header says, in the shape callers need. */
export interface FlatGeobufHeader {
  featuresCount: number;
  /** Whether the file carries a spatial index (needed to read part of it). */
  indexed: boolean;
  /** The index's node size (0 without one). */
  nodeSize: number;
  /** `[west, south, east, north]`, when the header records an extent. */
  envelope?: [number, number, number, number];
  /** The declared CRS, e.g. "EPSG:4326", when the header records one. */
  crs?: string;
}

/** The raw header object the library hands `headerMetaFn`. */
interface RawHeader {
  featuresCount?: number | bigint;
  indexNodeSize?: number;
  envelope?: ArrayLike<number> | null;
  crs?: { org?: string | null; code?: number; code_string?: string | null } | null;
}

/** Whether an index node size is one FlatGeobuf readers accept (the library's 2–65,535). */
export function validNodeSize(nodeSize: number): boolean {
  return Number.isInteger(nodeSize) && nodeSize >= 2 && nodeSize <= 65535;
}

/** Normalize the library's header. */
function toHeader(raw: RawHeader): FlatGeobufHeader {
  const env = raw.envelope;
  const envelope =
    env && env.length >= 4 && [0, 1, 2, 3].every((i) => Number.isFinite(env[i]!))
      ? ([env[0]!, env[1]!, env[2]!, env[3]!] as [number, number, number, number])
      : undefined;
  const crs = raw.crs;
  let crsName: string | undefined;
  if (crs && (crs.code || crs.code_string)) {
    crsName = crs.code ? `${crs.org || "EPSG"}:${crs.code}` : String(crs.code_string);
  }
  return {
    featuresCount: Number(raw.featuresCount ?? 0),
    indexed: (raw.indexNodeSize ?? 0) > 0,
    nodeSize: raw.indexNodeSize ?? 0,
    ...(envelope ? { envelope } : {}),
    ...(crsName ? { crs: crsName } : {}),
  };
}

/**
 * Whether a header describes longitude/latitude data (the shared rule in
 * ./crs: a known code, else the extent decides).
 */
export function isLonLat(header: FlatGeobufHeader, raw?: RawHeader): boolean {
  return isLonLatCrs({
    org: raw?.crs?.org,
    code: raw?.crs?.code,
    ...(header.envelope ? { envelope: header.envelope } : {}),
  });
}

/** Whether bytes start with a Zstandard frame (`28 B5 2F FD`) or skippable frame. */
export function isZstd(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd) return true;
  // Skippable frames (a seekable file may begin with one): 0x184D2A5? little-endian.
  return (bytes[0]! & 0xf0) === 0x50 && bytes[1] === 0x2a && bytes[2] === 0x4d && bytes[3] === 0x18;
}

/**
 * A compressed FlatGeobuf (ml-aot.109). This version reads uncompressed files
 * only: the reader's seekable-Zstandard mode needs a WebAssembly codec served
 * next to the script, which no CDN build can promise. Recognized by its
 * first bytes, so the notice says what the file is instead of "not a
 * FlatGeobuf file".
 */
function compressedFailure(url: string): FormatError {
  return host().formatError({ code: "compressed", format: "flatgeobuf", url });
}

/** The plain-language error for what `fetch` threw. */
function fetchFailure(error: unknown, url: string): unknown {
  if (isAbortError(error)) return error;
  return host().formatError({ code: "cors", format: "flatgeobuf", url });
}

/** Map what the library threw while reading to a classified error. */
function readFailure(error: unknown, url: string): unknown {
  if (isAbortError(error) || isFormatError(error)) return error;
  const message = String((error as { message?: unknown } | null)?.message ?? error);
  if (/not a flatgeobuf file|invalid header size|unexpected end|offset is outside/i.test(message)) {
    return host().formatError({ code: "not-format", format: "flatgeobuf", url });
  }
  if (/no index found/i.test(message)) {
    return host().formatError({ code: "no-index", format: "flatgeobuf", url });
  }
  const http = /HTTP request failed:\s*(\d+)\s*(.*)$/i.exec(message);
  if (http) {
    return Object.assign(new Error(`HTTP ${http[1]}: ${http[2] ?? ""} for ${url}`), {
      url,
      status: Number(http[1]),
    });
  }
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return host().formatError({ code: "cors", format: "flatgeobuf", url });
  }
  return host().formatError({ code: "read", format: "flatgeobuf", url, detail: message });
}

/** A header hook that rejects projected data before any feature is decoded. */
function headerCheck(url: string, onHeader?: (header: FlatGeobufHeader) => void) {
  return (raw: RawHeader) => {
    const header = toHeader(raw);
    // A spatial index with a node size no reader accepts (ml-cnv.31): the
    // library computes the index's size with 2 instead and reads the wrong
    // bytes, or throws "Node size must be at least 2".
    if (header.indexed && !validNodeSize(header.nodeSize)) {
      throw host().formatError({
        code: "read",
        format: "flatgeobuf",
        url,
        detail:
          `its spatial index is malformed (node size ${header.nodeSize}; readers accept 2 to 65,535). ` +
          `Re-create it: \`ogr2ogr -f FlatGeobuf -lco SPATIAL_INDEX=YES indexed.fgb ${url.replace(/[?#].*$/, "").split("/").pop()}\``,
      });
    }
    if (!isLonLat(header, raw)) {
      throw host().formatError({
        code: "crs",
        format: "flatgeobuf",
        url,
        ...(header.crs ? { crs: header.crs } : {}),
      });
    }
    onHeader?.(header);
  };
}

/** Collect a feature iterator, stopping early when the read is superseded. */
async function collect(
  iterator: AsyncIterable<unknown>,
  isCurrent: () => boolean
): Promise<FeatureCollection | null> {
  const features: Feature[] = [];
  for await (const feature of iterator) {
    if (!isCurrent()) return null;
    features.push(feature as Feature);
  }
  return { type: "FeatureCollection", features };
}

/**
 * Decode a whole-file response into a FeatureCollection.
 *
 * @returns `null` when `isCurrent()` turned false mid-read (superseded).
 */
export async function decodeStream(
  opened: OpenedFile,
  url: string,
  options: {
    isCurrent?: () => boolean;
    onHeader?: (header: FlatGeobufHeader) => void;
    /**
     * Stop (with `BodyTooLarge`) once this many bytes have streamed —
     * the size guard for a response that didn't say its size
     * (`Content-Length` missing on a chunked or compressed response).
     */
    maxBytes?: number;
  } = {}
): Promise<FeatureCollection | null> {
  const body = opened.response.body;
  // The file's first bytes, kept to name a compressed file if decoding fails.
  let head: Uint8Array | undefined;
  try {
    let input: ReadableStream<Uint8Array> | Uint8Array;
    if (body) {
      let streamed = 0;
      const max = options.maxBytes;
      input = body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            head ??= chunk.slice(0, 4);
            streamed += chunk.byteLength;
            if (max !== undefined && streamed > max) {
              controller.error(new (host().BodyTooLarge)(streamed));
              return;
            }
            controller.enqueue(chunk);
          },
        })
      );
    } else {
      input = new Uint8Array(await opened.response.arrayBuffer());
      head = input.slice(0, 4);
      if (options.maxBytes !== undefined && input.byteLength > options.maxBytes) {
        throw new (host().BodyTooLarge)(input.byteLength);
      }
    }
    return await collect(
      deserialize(input as never, { headerMetaFn: headerCheck(url, options.onHeader) as never }),
      options.isCurrent ?? (() => true)
    );
  } catch (error) {
    if (error instanceof host().BodyTooLarge) throw error;
    if (head && isZstd(head) && !isFormatError(error) && !isAbortError(error)) throw compressedFailure(url);
    throw readFailure(error, url);
  }
}

/**
 * Decode a whole FlatGeobuf file already in memory (`mlym emit` reads the
 * file from disk or the network, then converts it here). Node-safe.
 *
 * @param bytes - The file.
 * @param url - Its name, for messages.
 */
export async function decodeBytes(bytes: Uint8Array, url: string): Promise<FeatureCollection> {
  if (isZstd(bytes)) throw compressedFailure(url);
  try {
    const data = await collect(
      deserialize(bytes, { headerMetaFn: headerCheck(url) as never }),
      () => true
    );
    return data!;
  } catch (error) {
    throw readFailure(error, url);
  }
}

/** What {@link probe} learned from one small range request. */
export interface ProbeResult {
  /** Whether the server honoured `Range:` (206). */
  ranges: boolean;
  /** Total file size, from `Content-Range` (or `Content-Length` on a 200). */
  size?: number;
}

/**
 * One 8-byte range request: does the server support ranges, is this a
 * FlatGeobuf file at all, and how big is it.
 *
 * @throws The `HTTP <status>` shape for an error status; a {@link FormatError}
 *   for CORS/unreachable (`cors`) or wrong bytes (`not-format`).
 */
export async function probe(url: string, signal?: AbortSignal): Promise<ProbeResult> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Range: "bytes=0-7" }, ...(signal ? { signal } : {}) });
  } catch (error) {
    const failure = fetchFailure(error, url);
    // A reply that wouldn't decode: a host that compresses the parts of files
    // it sends (jsDelivr's Cloudflare leg)?
    if (isFormatError(failure) && failure.failure.code === "cors" && (await host().http.rangeRepliesUnreadable(url))) {
      throw host().formatError({ code: "encoded-range", format: "flatgeobuf", url });
    }
    throw failure;
  }
  if (!response.ok) throw host().http.httpError(response, url);
  if (response.status !== 206) {
    const length = Number(response.headers.get("content-length"));
    void response.body?.cancel().catch(() => undefined);
    return { ranges: false, ...(Number.isFinite(length) && length > 0 ? { size: length } : {}) };
  }
  if (host().http.isEncodedRange(response)) {
    // Parts of a compressed copy (jsDelivr's Cloudflare leg): the index
    // can't be read a part at a time from this host.
    void response.body?.cancel().catch(() => undefined);
    throw host().formatError({ code: "encoded-range", format: "flatgeobuf", url });
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const magic = bytes[0] === 0x66 && bytes[1] === 0x67 && bytes[2] === 0x62;
  if (!magic && isZstd(bytes)) throw compressedFailure(url);
  if (!magic && (await host().http.rangeRepliesUnreadable(url))) {
    throw host().formatError({ code: "encoded-range", format: "flatgeobuf", url });
  }
  if (!magic) throw host().formatError({ code: "not-format", format: "flatgeobuf", url });
  const total = /\/(\d+)\s*$/.exec(response.headers.get("content-range") ?? "")?.[1];
  return { ranges: true, ...(total ? { size: Number(total) } : {}) };
}

// ---------------------------------------------------------------------------
// Facts: what `mlym prepare` reports (large data round 2, U6; KTD12)
// ---------------------------------------------------------------------------

/** A FlatGeobuf file's facts, from its header alone ({@link headerFacts}). */
export interface FlatGeobufFacts {
  format: "flatgeobuf";
  /** The file's size in bytes (the buffer's `byteLength`). */
  byteLength: number;
  /** The header's feature count (0 when the writer didn't record it). */
  features: number;
  /** Whether the file carries a spatial index (index node size > 0): what reading by view needs. */
  indexed: boolean;
  /** The index's node size (0 without one; readers accept 2 to 65,535). */
  nodeSize: number;
  /** The header's geometry type (`Point`, `Polygon`, …; `Unknown` for mixed). */
  geometryType: string;
  /** The declared CRS, e.g. "EPSG:4326" or "EPSG:3857", when the header records one. */
  crs?: string;
  /** Whether the data is longitude/latitude — what this version draws. */
  lonLat: boolean;
  /** `[west, south, east, north]`, when the header records an extent. */
  envelope?: [number, number, number, number];
  /** The attribute columns the header declares. */
  columns: string[];
}

/** FlatGeobuf's geometry types, by their header code. */
const GEOMETRY_TYPES = [
  "Unknown", "Point", "LineString", "Polygon", "MultiPoint", "MultiLineString", "MultiPolygon",
  "GeometryCollection", "CircularString", "CompoundCurve", "CurvePolygon", "MultiCurve",
  "MultiSurface", "Curve", "Surface", "PolyhedralSurface", "TIN", "Triangle",
];

/** The largest header the library reads (its `HEADER_MAX_BUFFER_SIZE`). */
const HEADER_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Read a FlatGeobuf file's facts through any `AsyncBuffer` — a file handle
 * in the CLI, a range reader over HTTP — touching only its first 12 bytes
 * and its header. A projected CRS is reported, not refused; Node-safe.
 *
 * @param name - The file's name or URL, for messages.
 * @throws A {@link FormatError}: `not-format` (not FlatGeobuf, or a header
 *   cut short), `compressed` (a Zstandard-compressed file), `read`.
 */
export async function headerFacts(buffer: AsyncBuffer, name: string): Promise<FlatGeobufFacts> {
  const notFormat = () => host().formatError({ code: "not-format", format: "flatgeobuf", url: name });
  let raw: (RawHeader & { geometryType?: number; columns?: { name: string }[] | null }) | undefined;
  try {
    if (!(buffer.byteLength >= 12)) throw notFormat();
    const head = new Uint8Array(await buffer.slice(0, 12));
    if (isZstd(head)) throw compressedFailure(name);
    if (!(head[0] === 0x66 && head[1] === 0x67 && head[2] === 0x62)) throw notFormat();
    const length = new DataView(head.buffer, head.byteOffset, 12).getUint32(8, true);
    if (length < 8 || length > HEADER_MAX_BYTES || 12 + length > buffer.byteLength) throw notFormat();
    const bytes = new Uint8Array(12 + length);
    bytes.set(head);
    bytes.set(new Uint8Array(await buffer.slice(12, 12 + length)), 12);
    // The library parses the header and hands it over before any feature:
    // stop there (the bytes end with the header).
    const stop = new Error("header read");
    try {
      const features = deserialize(bytes, {
        headerMetaFn: ((header: typeof raw) => {
          raw = header;
          throw stop;
        }) as never,
      });
      await features.next();
    } catch (error) {
      if (error !== stop) throw error;
    }
  } catch (error) {
    throw readFailure(error, name);
  }
  if (!raw) throw notFormat();
  const header = toHeader(raw);
  return {
    format: "flatgeobuf",
    byteLength: buffer.byteLength,
    features: header.featuresCount,
    indexed: header.indexed,
    nodeSize: header.nodeSize,
    geometryType: GEOMETRY_TYPES[raw.geometryType ?? 0] ?? "Unknown",
    ...(header.crs ? { crs: header.crs } : {}),
    lonLat: isLonLat(header, raw),
    ...(header.envelope ? { envelope: header.envelope } : {}),
    columns: (raw.columns ?? []).map((column) => column.name),
  };
}

/**
 * How many features of an indexed file a view holds, estimated from its
 * spatial index before reading any (see `indexLevel`, above).
 */
export function readIndexLevel(url: string, header: FlatGeobufHeader): Promise<FeaturesInView> {
  return indexLevel(url, header.featuresCount, header.nodeSize);
}

/**
 * Read only the features intersecting `bbox`, through the spatial index.
 *
 * @param bbox - `[west, south, east, north]`.
 * @returns `null` when `isCurrent()` turned false mid-read (superseded).
 */
export async function readBbox(
  url: string,
  bbox: [number, number, number, number],
  options: { isCurrent?: () => boolean; onHeader?: (header: FlatGeobufHeader) => void } = {}
): Promise<FeatureCollection | null> {
  const [minX, minY, maxX, maxY] = bbox;
  try {
    return await collect(
      deserialize(url, {
        rect: { minX, minY, maxX, maxY },
        headerMetaFn: headerCheck(url, options.onHeader) as never,
      }),
      options.isCurrent ?? (() => true)
    );
  } catch (error) {
    throw readFailure(error, url);
  }
}

// ---------------------------------------------------------------------------
// The data provider
// ---------------------------------------------------------------------------

/**
 * Read a whole FlatGeobuf file, with the size guards: over
 * {@link WHOLE_FILE_WARN_BYTES} a console note; over
 * {@link WHOLE_FILE_MAX_BYTES}, or a header counting more than
 * {@link WHOLE_FILE_MAX_FEATURES} features, nothing is decoded and it rejects
 * with {@link WholeFileTooLarge} (the loader then reads by view).
 *
 * @returns `null` when `isCurrent()` turned false mid-read (superseded).
 */
export async function loadFlatGeobufWhole(
  url: string,
  options: {
    isCurrent?: () => boolean;
    onHeader?: (header: FlatGeobufHeader) => void;
    /** The size guards (tests pass smaller ones). */
    limits?: SizeLimits;
    /**
     * The file's `GET`, already started — by the main bundle, while this
     * chunk downloaded (the two overlap, as before the reader moved here).
     */
    started?: StartedOpen;
  } = {}
): Promise<FeatureCollection | null> {
  const limits = host().sizeLimits(options.limits);
  const abort = options.started?.abort ?? new AbortController();
  const opened = await (options.started?.opened ?? host().openWhole(url, abort.signal));
  const cost = (size: number | undefined, features?: number) => ({ size, features, limits: costLimits(limits) });
  if (opened.size !== undefined && opened.size > limits.max) {
    host().discard(opened);
    throw new (host().WholeFileTooLarge)(opened.size, undefined, undefined, cost(opened.size));
  }
  // Over the note's size, the note waits for the header: whether the file
  // has an index decides what to suggest (ml-cnv.35).
  const noteSize = opened.size !== undefined && opened.size > limits.warn ? opened.size : undefined;
  const ranges = /bytes/i.test(opened.response.headers.get("accept-ranges") ?? "");
  // The header's feature count arrives before any feature: what decoding
  // will cost, whatever the bytes (ml-37r.16).
  let features: number | undefined;
  // Without Content-Length (a chunked or compressed response) the guard
  // counts the bytes as they stream.
  try {
    return await decodeStream(opened, url, {
      ...(options.isCurrent ? { isCurrent: options.isCurrent } : {}),
      onHeader: (header) => {
        if (header.featuresCount > limits.maxFeatures) {
          features = header.featuresCount;
          abort.abort();
          throw Error();
        }
        if (noteSize !== undefined) {
          const byView = header.indexed
            ? `To read only the part in view, add \`load: viewport\` (it has a spatial index${ranges ? "" : "; it needs a host with HTTP range requests"})`
            : `To read only the part in view, give it a spatial index (${host().messages.indexedFlatGeobufCommand(url)}) and add \`load: viewport\``;
          console.warn(
            "[maplibre-yaml] " +
              host().consoleText(
              `${url} is ${mb(noteSize)}; loading it whole may take a few seconds. ${byView}; to draw it at ` +
                `every zoom, convert it to PMTiles. ${host().messages.largeDataLinks("flatgeobuf")}`
            )
          );
        }
        options.onHeader?.(header);
      },
      ...(opened.size === undefined ? { maxBytes: limits.max } : {}),
    });
  } catch (error) {
    const { BodyTooLarge, WholeFileTooLarge } = host();
    if (features !== undefined) throw new WholeFileTooLarge(opened.size, undefined, features, cost(opened.size, features));
    if (error instanceof BodyTooLarge) throw new WholeFileTooLarge(error.size, undefined, undefined, cost(error.size));
    throw error;
  }
}

/** A rectangle no feature intersects: reading it fetches just the header and index root. */
const HEADER_ONLY: BBox = [-180, -90, -180, -90];

/**
 * Reads one FlatGeobuf source into its GeoJSON data — the data provider
 * the GeoJSON `url:` pipeline calls instead of its JSON fetch.
 *
 * @remarks
 * `load: all` (default): one streamed `GET`, decoded once; works on any
 * static host. Size guards: up to {@link WHOLE_FILE_WARN_BYTES} silently,
 * up to {@link WHOLE_FILE_MAX_BYTES} (and {@link WHOLE_FILE_MAX_FEATURES})
 * with console advice, beyond that an indexed file switches to the viewport
 * read and an unindexed one is refused with a notice.
 *
 * `load: viewport`: only the features in view, through the spatial index
 * (see {@link ViewLoader}); a view's features are estimated before reading
 * from one level of that index. Needs range requests — on a server without
 * them a file that fits the size guard is read whole instead (with a console
 * note), a larger one is refused.
 */
export class FlatGeobufLoader extends ViewLoader<StartedOpen> {
  protected readonly format = "flatgeobuf" as const;
  private header: FlatGeobufHeader | undefined;
  private inView: FeaturesInView | undefined;

  constructor(
    map: MapLibreMap,
    url: string,
    load: LoadMode,
    callbacks: FlatGeobufCallbacks,
    limits?: SizeLimits
  ) {
    super(map, url, load, callbacks, host().sizeLimits(limits, load));
  }

  /**
   * The file's extent from its header, `[[w, s], [e, n]]` — what `fitTo`
   * frames for a source read by view, whose data is only the part in view.
   */
  get extent(): [[number, number], [number, number]] | undefined {
    const env = this.header?.envelope;
    return env ? [[env[0], env[1]], [env[2], env[3]]] : undefined;
  }

  /**
   * The whole-file read — or, when the host already started it (the `fitTo`
   * prefetch, ml-aot.75, through {@link loadFlatGeobufWhole}), its result.
   */
  protected async readWhole(started?: Promise<FeatureCollection>): Promise<void> {
    const generation = ++this.generation;
    let data: FeatureCollection | null;
    try {
      const opening = started ? undefined : this.takeOpening();
      data = started
        ? await started
        : await loadFlatGeobufWhole(this.url, {
            isCurrent: () => generation === this.generation && !this.destroyed,
            onHeader: (header) => (this.header = header),
            limits: this.limits,
            ...(opening ? { started: opening } : {}),
          });
    } catch (error) {
      if (!(error instanceof host().WholeFileTooLarge)) throw error;
      // The "reading by view instead" note is logged once the header shows
      // an index (startViewport): an unindexed file is refused instead, and
      // a note promising the by-view read would contradict that (ml-aot.103).
      await this.startViewport(true, error);
      return;
    }
    this.deliver(data);
  }

  /**
   * Switch to reading by view: check range support, read the header (and
   * whether there is an index), then follow the map.
   *
   * @param auto - true when a too-large whole-file read switched here; a
   *   missing index then means "too large", not "add an index for viewport".
   */
  protected async startViewport(auto: boolean, tooLarge?: WholeFileTooLarge): Promise<void> {
    const probed = await probe(this.url);
    const total = probed.size ?? tooLarge?.size;
    if (!probed.ranges) {
      if (!auto && (total === undefined || total <= this.limits.max)) {
        console.warn(noRangeNote(this.url, "`load: viewport` reads the whole file instead"));
        await this.readWhole();
        return;
      }
      // Too large to read whole, and this host can't serve it by view: the
      // hosting is what to change (not `load: viewport`, which needs it).
      throw this.tooLarge(tooLarge, total, "no-range");
    }

    // Header first: fitTo frames the whole file, and a missing index fails
    // before the map starts following the view.
    try {
      await readBbox(this.url, HEADER_ONLY, { onHeader: (h) => (this.header = h) });
    } catch (error) {
      if (auto && isFormatError(error) && error.failure.code === "no-index") {
        throw this.tooLarge(tooLarge, total, "no-index");
      }
      throw error;
    }
    if (this.destroyed) return;
    if (auto) this.autoNote(tooLarge, total);
    // One level of the index (at most 160 KB, once): each view's features
    // are estimated from it before anything is read (ml-37r.17). Without
    // it, the header's count and extent estimate them.
    try {
      if (this.header) this.inView = await readIndexLevel(this.url, this.header);
    } catch {
      /* the header's estimate */
    }
    await this.follow();
  }

  /** The refusal of a file too large to read whole that can't be read by view either. */
  private tooLarge(
    tooLarge: WholeFileTooLarge | undefined,
    size: number | undefined,
    blocker: "no-range" | "no-index"
  ): FormatError {
    return host().formatError({
      code: "too-large",
      format: "flatgeobuf",
      url: this.url,
      size: tooLarge?.size ?? size,
      features: tooLarge?.features ?? this.header?.featuresCount,
      limits: costLimits(this.limits),
      blocker,
    });
  }

  /** From the index (or the header's count and extent, without it). */
  protected estimate(view: BBox): number {
    const header = this.header;
    if (this.inView) return this.inView(view);
    return header?.envelope ? header.featuresCount * shareInView(header.envelope, view) : 0;
  }

  protected readView(view: BBox, isCurrent: () => boolean): Promise<FeatureCollection | null> {
    return readBbox(this.url, view, { isCurrent, onHeader: (h) => (this.header = h) });
  }
}
