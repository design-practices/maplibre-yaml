/**
 * @file FlatGeobuf: decode a `.fgb` file into GeoJSON features (0.9, ml-cnv.3)
 * @module @maplibre-yaml/core/formats/flatgeobuf
 *
 * @description
 * FlatGeobuf is a binary feature file with an optional spatial index. Core
 * reads it into an ordinary MapLibre GeoJSON source, so layers, popups,
 * legend, `fitTo` and clustering behave exactly as for a `.geojson` file.
 *
 * Two reads, matching the source's `load:`:
 *
 * - **whole file** ({@link openWhole} + {@link decodeStream}): one streamed
 *   `GET`. Needs no range support — works on any static host.
 * - **part of it** ({@link probe} + {@link readBbox}): only the features in a
 *   bounding box, through the file's packed R-tree, with HTTP range requests.
 *
 * Every failure becomes a {@link FormatError} with a plain-language message,
 * except an HTTP error status, which is thrown in the shape the GeoJSON
 * fetcher uses (`HTTP 404: Not Found for <url>`) so the on-page notice words
 * a missing `.fgb` exactly like a missing `.geojson` (with the same `base`
 * advice).
 *
 * The library's own logging: its `dist/esm` build carries no `console.debug`
 * range chatter (the `lib/mjs` build does), which is why the seam imports the
 * `flatgeobuf/geojson` export.
 *
 * **The library is downloaded on demand** (`chunks/flatgeobuf.js`, through
 * formats/decoders): this module stays in the main bundle and fetches it the
 * first time a file is decoded. A download failure is a {@link FormatError}
 * of code `"chunk"`.
 */

import type { Feature, FeatureCollection } from "geojson";
import { isLonLatCrs } from "./crs";
import { getDecoder, type Decoders } from "./decoders";
import { FormatError, isAbortError, isFormatError } from "./errors";
import { BodyTooLarge } from "./http";

/** The library's `deserialize` (`flatgeobuf/geojson`), loaded on demand. */
type Deserialize = Decoders["flatgeobuf"]["deserialize"];

/** What the file's header says, in the shape callers need. */
export interface FlatGeobufHeader {
  featuresCount: number;
  /** Whether the file carries a spatial index (needed to read part of it). */
  indexed: boolean;
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
  return new FormatError({ code: "compressed", format: "flatgeobuf", url });
}

/** The plain-language error for what `fetch` threw. */
function fetchFailure(error: unknown, url: string): unknown {
  if (isAbortError(error)) return error;
  return new FormatError({ code: "cors", format: "flatgeobuf", url });
}

/** The GeoJSON fetcher's HTTP error shape, so the notice treats both alike. */
function httpError(response: Response, url: string): Error {
  return Object.assign(
    new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`),
    { url, status: response.status }
  );
}

/** Map what the library threw while reading to a classified error. */
function readFailure(error: unknown, url: string): unknown {
  if (isAbortError(error) || isFormatError(error)) return error;
  const message = String((error as { message?: unknown } | null)?.message ?? error);
  if (/not a flatgeobuf file|invalid header size|unexpected end|offset is outside/i.test(message)) {
    return new FormatError({ code: "not-format", format: "flatgeobuf", url });
  }
  if (/no index found/i.test(message)) {
    return new FormatError({ code: "no-index", format: "flatgeobuf", url });
  }
  const http = /HTTP request failed:\s*(\d+)\s*(.*)$/i.exec(message);
  if (http) {
    return Object.assign(new Error(`HTTP ${http[1]}: ${http[2] ?? ""} for ${url}`), {
      url,
      status: Number(http[1]),
    });
  }
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return new FormatError({ code: "cors", format: "flatgeobuf", url });
  }
  return new FormatError({ code: "read", format: "flatgeobuf", url, detail: message });
}

/** A header hook that rejects projected data before any feature is decoded. */
function headerCheck(url: string, onHeader?: (header: FlatGeobufHeader) => void) {
  return (raw: RawHeader) => {
    const header = toHeader(raw);
    if (!isLonLat(header, raw)) {
      throw new FormatError({
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

/** A response opened for a whole-file read, before its body is decoded. */
export interface OpenedFile {
  response: Response;
  /** `Content-Length`, when the server sent one. */
  size?: number;
}

/**
 * Start a whole-file read: one `GET`, headers only. The caller decides from
 * the size whether to decode ({@link decodeStream}) or switch to reading
 * part of the file.
 */
export async function openWhole(url: string, signal?: AbortSignal): Promise<OpenedFile> {
  let response: Response;
  try {
    response = await fetch(url, signal ? { signal } : {});
  } catch (error) {
    throw fetchFailure(error, url);
  }
  if (!response.ok) throw httpError(response, url);
  const length = Number(response.headers.get("content-length"));
  return { response, ...(Number.isFinite(length) && length > 0 ? { size: length } : {}) };
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
     * Stop (with {@link BodyTooLarge}) once this many bytes have streamed —
     * the size guard for a response that didn't say its size
     * (`Content-Length` missing on a chunked or compressed response).
     */
    maxBytes?: number;
  } = {}
): Promise<FeatureCollection | null> {
  let deserialize: Deserialize;
  try {
    ({ deserialize } = await getDecoder("flatgeobuf"));
  } catch (error) {
    discard(opened);
    throw error;
  }
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
              controller.error(new BodyTooLarge(streamed));
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
        throw new BodyTooLarge(input.byteLength);
      }
    }
    return await collect(
      deserialize(input as never, { headerMetaFn: headerCheck(url, options.onHeader) as never }),
      options.isCurrent ?? (() => true)
    );
  } catch (error) {
    if (error instanceof BodyTooLarge) throw error;
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
  const { deserialize } = await getDecoder("flatgeobuf");
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

/** Throw away a response body that won't be read. */
export function discard(opened: OpenedFile): void {
  try {
    void opened.response.body?.cancel().catch(() => undefined);
  } catch {
    // Already consumed or locked: nothing to release.
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
    throw fetchFailure(error, url);
  }
  if (!response.ok) throw httpError(response, url);
  if (response.status !== 206) {
    const length = Number(response.headers.get("content-length"));
    void response.body?.cancel().catch(() => undefined);
    return { ranges: false, ...(Number.isFinite(length) && length > 0 ? { size: length } : {}) };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const magic = bytes[0] === 0x66 && bytes[1] === 0x67 && bytes[2] === 0x62;
  if (!magic && isZstd(bytes)) throw compressedFailure(url);
  if (!magic) throw new FormatError({ code: "not-format", format: "flatgeobuf", url });
  const total = /\/(\d+)\s*$/.exec(response.headers.get("content-range") ?? "")?.[1];
  return { ranges: true, ...(total ? { size: Number(total) } : {}) };
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
  const { deserialize } = await getDecoder("flatgeobuf");
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
