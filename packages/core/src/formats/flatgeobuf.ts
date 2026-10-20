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
 * range chatter (the `lib/mjs` build does), which is why this imports the
 * `flatgeobuf/geojson` export.
 */

import { deserialize } from "flatgeobuf/geojson";
import type { Feature, FeatureCollection } from "geojson";
import { FormatError, isAbortError, isFormatError } from "./errors";

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

/** Longitude/latitude CRS codes MapLibre can draw as-is. */
const LON_LAT_CODES = new Set([4326, 4269, 4258, 4283, 4619, 4148, 4674]);

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
 * Whether a header describes longitude/latitude data.
 *
 * @remarks
 * By the declared code when there is one (EPSG:4326 and the other
 * geographic datums), else by the extent: a projected file's coordinates
 * run far past ±180/±90.
 */
export function isLonLat(header: FlatGeobufHeader, raw?: RawHeader): boolean {
  const code = raw?.crs?.code;
  const org = (raw?.crs?.org ?? "EPSG").toUpperCase();
  if (code && org === "EPSG" && !LON_LAT_CODES.has(code)) return false;
  if (raw?.crs?.code_string && /CRS84/i.test(raw.crs.code_string)) return true;
  const env = header.envelope;
  if (env) {
    const [w, s, e, n] = env;
    if (Math.abs(w) > 180.5 || Math.abs(e) > 180.5 || Math.abs(s) > 90.5 || Math.abs(n) > 90.5) {
      return false;
    }
  }
  return true;
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
  options: { isCurrent?: () => boolean; onHeader?: (header: FlatGeobufHeader) => void } = {}
): Promise<FeatureCollection | null> {
  const body = opened.response.body;
  try {
    const input = body ?? new Uint8Array(await opened.response.arrayBuffer());
    return await collect(
      deserialize(input as never, { headerMetaFn: headerCheck(url, options.onHeader) as never }),
      options.isCurrent ?? (() => true)
    );
  } catch (error) {
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
