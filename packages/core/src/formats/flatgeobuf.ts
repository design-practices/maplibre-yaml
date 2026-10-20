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

/**
 * Geographic (longitude/latitude) EPSG codes MapLibre can draw as-is: WGS 84
 * and the national datums that differ from it by metres at most. Any
 * EPSG:4xxx code below 4400 is a geographic 2D CRS by the registry's own
 * numbering; these are the ones outside that block.
 */
const LON_LAT_CODES = new Set([
  4326, 4979, // WGS 84 (2D, 3D)
  4269, 6318, 4152, 4759, // NAD83 and its realizations
  4258, 4937, // ETRS89
  4283, 7844, // GDA94, GDA2020
  4612, 6668, // JGD2000, JGD2011
  4617, 4619, 4148, 4674, 4686, 4490, 4167, 4624, 4171, 5340, 4818, 9777,
]);

/**
 * Projected EPSG codes that are common enough to name outright, so a file
 * whose small extent happens to fit inside ±180/±90 is still refused: Web
 * Mercator (and its legacy aliases), World Mercator, and the UTM zones.
 */
function isKnownProjected(code: number): boolean {
  return (
    code === 3857 ||
    code === 900913 ||
    code === 3395 ||
    code === 102100 ||
    code === 102113 ||
    (code >= 32601 && code <= 32660) || // WGS 84 / UTM north
    (code >= 32701 && code <= 32760) || // WGS 84 / UTM south
    (code >= 25828 && code <= 25838) || // ETRS89 / UTM
    (code >= 26901 && code <= 26923) // NAD83 / UTM
  );
}

/** Whether an EPSG code is a known geographic CRS. */
function isGeographicCode(code: number): boolean {
  return LON_LAT_CODES.has(code) || (code >= 4000 && code < 4400);
}

/** Whether an extent lies within longitude/latitude bounds (a little slack). */
function withinLonLat(env: readonly number[]): boolean {
  const [w, s, e, n] = env as [number, number, number, number];
  return Math.abs(w) <= 180.5 && Math.abs(e) <= 180.5 && Math.abs(s) <= 90.5 && Math.abs(n) <= 90.5;
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
 * Whether a header describes longitude/latitude data.
 *
 * @remarks
 * - A known geographic EPSG code (4326, the national datums) or `CRS84`:
 *   yes — unless the extent says otherwise (a mislabelled file).
 * - A known projected code (Web Mercator, UTM): no.
 * - Any other code, or none: the extent decides — within ±180/±90 is
 *   longitude/latitude; a projected file's coordinates run far past it.
 *   With no extent either, the file is given the benefit of the doubt.
 */
export function isLonLat(header: FlatGeobufHeader, raw?: RawHeader): boolean {
  const env = header.envelope;
  if (env && !withinLonLat(env)) return false;
  const code = raw?.crs?.code;
  const org = (raw?.crs?.org ?? "EPSG").toUpperCase();
  if (code && org === "EPSG") {
    if (isGeographicCode(code)) return true;
    if (isKnownProjected(code)) return false;
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
