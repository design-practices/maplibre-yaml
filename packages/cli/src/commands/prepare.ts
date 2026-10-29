/**
 * @file The `mlym prepare` command — what a data file is, and what to do with it
 *
 * @description
 * `mlym prepare <file>` looks at a GeoParquet, FlatGeobuf, GeoJSON or
 * PMTiles file — a local path or an `http(s)` URL — and prints its facts
 * (features, size, CRS, geometry, sort order, bbox column, row-group size,
 * overview levels), the one recommended route from the Large data guide's
 * size-to-format table with its commands, filenames filled in, and the YAML
 * source block to paste. It reads; it never writes data, and it runs nothing.
 *
 * The contract (R13, KTD12):
 *
 * - GeoParquet and FlatGeobuf: only the footer or header is read, through
 *   core's facts readers over an `AsyncBuffer` (a file handle, or range
 *   requests for a URL; a server without range support is refused rather
 *   than downloaded whole). PMTiles: the 127-byte header and the metadata.
 *   GeoJSON: parsed in full up to 200 MB; above that, the feature count is
 *   estimated from the first 8 MB, and the report says so.
 * - The table (features at full detail): under 50,000, use it as it is;
 *   50,000 to 250,000, GeoParquet read by view (sorted, a bbox column) or an
 *   indexed FlatGeobuf; above 250,000, PMTiles via tylertoo for polygons,
 *   an overview GeoParquet file (experimental) for points and lines. A
 *   projected CRS or a GeoArrow encoding is fixed first. The commands are
 *   the ones the browser's hints print (lib/producer-commands).
 * - `-f json` prints one JSON object instead.
 * - Exit 0 with the report; 2 (FILE_NOT_FOUND) for a path or URL that cannot
 *   be read (missing, a folder, no permission, HTTP 4xx, unreachable); 1
 *   (VALIDATION_ERROR) for no file argument, a bad flag, a file of no format
 *   it reads (plain Parquet included), or a server without range requests;
 *   4 otherwise (an HTTP 5xx, an unexpected failure).
 */

import { defineCommand } from 'citty';
import { resolve } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import * as zlib from 'node:zlib';
import {
  readFlatGeobufFacts,
  readGeoParquetFacts,
  isFormatError,
  type AsyncBuffer,
  type FlatGeobufFacts,
  type GeoParquetFacts,
} from '@maplibre-yaml/core';
import { FileBufferError, openFileBuffer, openUrlBuffer, type FileBuffer } from '../lib/file-buffer.js';
import {
  commandStem,
  indexedFlatGeobufCommand,
  pmtilesCommand,
  shellCommands,
  sortedParquetCommand,
} from '../lib/producer-commands.js';
import { logger } from '../lib/logger.js';
import { EXIT_CODES, type ExitCode } from '../types.js';

/** A refusal with the exit code the command stops with. */
export class PrepareError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode,
  ) {
    super(message);
    this.name = 'PrepareError';
  }
}

/** A GeoJSON file's facts: counted from a full parse, or estimated from its first bytes. */
export interface GeoJsonFacts {
  format: 'geojson';
  byteLength: number;
  /** Features: counted, or (when `estimated`) the sample's count scaled to the file's size. */
  features: number;
  estimated: boolean;
  /** The bytes the estimate was made from (with `estimated`). */
  sampledBytes?: number;
  /** The geometry types seen (in the whole file, or in the sample). */
  geometryTypes: string[];
  /** A CRS named in the file's legacy `crs` member, or "a projected CRS" when coordinates are out of range. */
  crs?: string;
  lonLat: boolean;
}

/** A PMTiles archive's facts, from its header and metadata. */
export interface PmtilesFacts {
  format: 'pmtiles';
  byteLength: number;
  /** The spec version (3). */
  version: number;
  /** MVT, MLT, PNG, JPEG, WebP, AVIF or unknown. */
  tileType: string;
  /** Whether the tiles are vector tiles (MVT or MLT). */
  vector: boolean;
  minZoom: number;
  maxZoom: number;
  bounds?: [number, number, number, number];
  /** The vector layers the metadata lists: what `source-layer:` names. */
  layers: string[];
}

export type FileFacts = GeoParquetFacts | FlatGeobufFacts | GeoJsonFacts | PmtilesFacts;

/** One thing to run, and why. */
export interface PrepareStep {
  why: string;
  commands: string[];
}

/** What `mlym prepare` recommends for a file. */
export interface Recommendation {
  /** `no-change`: the file draws well as it is. */
  verdict: 'no-change' | 'change';
  /** The guide's route: use it as it is, read it by view, PMTiles, an overview file, or (PMTiles in) already tiles. */
  route: 'as-is' | 'by-view' | 'pmtiles' | 'overviews' | 'tiles';
  /** One sentence: the verdict and why. */
  summary: string;
  /** The commands to run, in order (empty for `no-change`). */
  steps: PrepareStep[];
  /** The `sources:` block to paste, for the file the steps produce. */
  yaml: string;
  /** Another route that fits some authors, with its own commands and YAML. */
  alternative?: { why: string; commands: string[]; yaml: string };
  notes: string[];
}

/** The report `mlym prepare` prints. */
export interface PrepareReport {
  /** The path (resolved) or URL that was read. */
  file: string;
  facts: FileFacts;
  recommendation: Recommendation;
}

export interface PrepareOptions {
  /** The fetch for a URL (default: the global one). */
  fetch?: typeof fetch;
  /** GeoJSON up to this size is parsed in full (default 200 MB). */
  fullParseBytes?: number;
  /** Above it, the feature count is estimated from this many first bytes (default 8 MB). */
  sampleBytes?: number;
}

const MB = 1024 * 1024;
const FULL_PARSE_BYTES = 200 * MB;
const SAMPLE_BYTES = 8 * MB;
/** The guide's size-to-format table, in features at full detail. */
export const AS_IS_FEATURES = 50_000;
export const BY_VIEW_FEATURES = 250_000;
/** Row groups larger than this make reading by view decode too much (the guide says about 10,000). */
const LARGE_ROW_GROUP = 25_000;
const GUIDE = 'https://docs.maplibre-yaml.org/guides/large-data/';

const isUrl = (file: string) => /^https?:\/\//i.test(file);
const count = (n: number) => Math.round(n).toLocaleString('en-US');
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

/** Bytes as "12.9 KB" or "300 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

// ---------------------------------------------------------------------------
// Reading the facts
// ---------------------------------------------------------------------------

type Detected = 'geoparquet' | 'flatgeobuf' | 'geojson' | 'pmtiles';

const FORMAT_NAMES: Record<Detected, string> = {
  geoparquet: 'GeoParquet',
  flatgeobuf: 'FlatGeobuf',
  geojson: 'GeoJSON',
  pmtiles: 'PMTiles',
};

const UNSUPPORTED =
  'mlym prepare reads GeoParquet (.parquet), FlatGeobuf (.fgb), GeoJSON (.geojson, .json) and PMTiles (.pmtiles) files.';

/** The file name in a path or URL. */
function fileNameOf(file: string): string {
  const path = file.replace(/[?#].*$/, '');
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1) || path;
}

/** The format the name's extension claims. */
function formatByName(file: string): Detected | undefined {
  const name = fileNameOf(file).toLowerCase();
  if (/\.(geo)?parquet$/.test(name)) return 'geoparquet';
  if (/\.fgb$/.test(name)) return 'flatgeobuf';
  if (/\.(geo)?json$/.test(name)) return 'geojson';
  if (/\.pmtiles$/.test(name)) return 'pmtiles';
  return undefined;
}

/** The format a file's first bytes say it is. */
function formatByBytes(head: Uint8Array): Detected | undefined {
  const text = (start: number, end: number) => String.fromCharCode(...head.subarray(start, end));
  if (text(0, 4) === 'PAR1') return 'geoparquet';
  if (text(0, 3) === 'fgb' && head[3] === 3 && text(4, 7) === 'fgb') return 'flatgeobuf';
  if (text(0, 7) === 'PMTiles') return 'pmtiles';
  let i = head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0; // UTF-8 BOM
  while (i < head.length && (head[i] === 0x20 || head[i] === 0x0a || head[i] === 0x0d || head[i] === 0x09)) i++;
  if (head[i] === 0x7b /* { */) return 'geojson';
  return undefined;
}

/** Open the file's bytes, mapping why it cannot be read to an exit code. */
async function openBuffer(file: string, options: PrepareOptions): Promise<AsyncBuffer & { close?: () => Promise<void> }> {
  if (isUrl(file)) {
    try {
      return await openUrlBuffer(file, options.fetch ? { fetch: options.fetch } : {});
    } catch (error) {
      throw urlFailure(file, error);
    }
  }
  try {
    return await openFileBuffer(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const why =
      code === 'ENOENT' ? 'no such file' : code === 'EISDIR' ? 'it is a folder' : code === 'EACCES' ? 'permission denied' : code;
    throw new PrepareError(`Could not read ${file} (${why ?? (error as Error).message}).`, EXIT_CODES.FILE_NOT_FOUND);
  }
}

/** A URL read failure as a refusal: no range support is the input's problem (1), 4xx and unreachable 2, 5xx 4. */
function urlFailure(url: string, error: unknown): PrepareError {
  if (error instanceof FileBufferError) {
    if (error.code === 'no-range') {
      return new PrepareError(
        `${url}: the server doesn't answer range requests, so mlym prepare can't read just the file's ` +
          'header or footer, and it does not download whole files. A map reading the file by view needs ' +
          'range requests too. Host it where they work (object storage such as S3, R2 or GCS, GitHub Pages, ' +
          'Netlify, or `npx serve` locally), or download it and run mlym prepare on the local copy.',
        EXIT_CODES.VALIDATION_ERROR,
      );
    }
    if (error.code === 'http' && error.status !== undefined && error.status >= 500) {
      return new PrepareError(`Could not read ${url}: ${error.message}. Try again later.`, EXIT_CODES.UNKNOWN_ERROR);
    }
    return new PrepareError(`Could not read ${url}: ${error.message}.`, EXIT_CODES.FILE_NOT_FOUND);
  }
  const cause = (error as { cause?: { code?: string; message?: string } }).cause;
  return new PrepareError(
    `Could not reach ${url} (${cause?.code ?? cause?.message ?? (error as Error).message}).`,
    EXIT_CODES.FILE_NOT_FOUND,
  );
}

async function bytes(buffer: AsyncBuffer, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await buffer.slice(start, end));
}

/** Read a file's facts: its footer or header, a PMTiles header, or a GeoJSON parse or sample. */
export async function readFacts(file: string, options: PrepareOptions = {}): Promise<FileFacts> {
  const buffer = await openBuffer(file, options);
  try {
    if (buffer.byteLength === 0) {
      throw new PrepareError(`${file} is empty. ${UNSUPPORTED}`, EXIT_CODES.VALIDATION_ERROR);
    }
    const head = await bytes(buffer, 0, Math.min(buffer.byteLength, 1024));
    const named = formatByName(file);
    const format = formatByBytes(head) ?? named;
    const name = fileNameOf(file);
    const looksHtml = /^\s*</.test(new TextDecoder().decode(head.subarray(0, 64)));
    if (!format) {
      throw new PrepareError(
        `${name} is not a file mlym prepare reads${looksHtml ? ' (it is an HTML page)' : ''}. ${UNSUPPORTED}`,
        EXIT_CODES.VALIDATION_ERROR,
      );
    }
    if (named && !formatByBytes(head) && (format === 'pmtiles' || format === 'geojson')) {
      // The name says PMTiles or GeoJSON; the bytes don't.
      throw new PrepareError(
        `${name} is named like a ${FORMAT_NAMES[format]} file, but it isn't one` +
          (looksHtml ? ': it is an HTML page (a server error page, or a link to a page about the file?).' : '.') +
          ` ${UNSUPPORTED}`,
        EXIT_CODES.VALIDATION_ERROR,
      );
    }
    try {
      switch (format) {
        case 'geoparquet':
          return await readGeoParquetFacts(buffer, name);
        case 'flatgeobuf':
          return await readFlatGeobufFacts(buffer, name);
        case 'pmtiles':
          return await pmtilesFacts(buffer, name);
        default:
          return await geojsonFacts(buffer, name, options);
      }
    } catch (error) {
      if (error instanceof PrepareError) throw error;
      if (isFormatError(error)) {
        throw new PrepareError(error.message.replace(/`/g, ''), EXIT_CODES.VALIDATION_ERROR);
      }
      if (isUrl(file) && (error instanceof FileBufferError || error instanceof TypeError)) throw urlFailure(file, error);
      throw error;
    }
  } finally {
    await (buffer as Partial<FileBuffer>).close?.();
  }
}

const TILE_TYPES = ['unknown', 'MVT', 'PNG', 'JPEG', 'WebP', 'AVIF', 'MLT'];

/** A PMTiles v3 archive's header (127 bytes) and the vector layers its metadata lists. */
async function pmtilesFacts(buffer: AsyncBuffer, name: string): Promise<PmtilesFacts> {
  const head = await bytes(buffer, 0, Math.min(buffer.byteLength, 127));
  const version = head[7] ?? 0;
  if (version !== 3 || head.length < 127) {
    throw new PrepareError(
      `${name} is a PMTiles version ${version} archive; maplibre-yaml reads version 3. ` +
        `Upgrade it with the pmtiles CLI: pmtiles convert ${name} ${name.replace(/\.pmtiles$/i, '')}-v3.pmtiles`,
      EXIT_CODES.VALIDATION_ERROR,
    );
  }
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const u64 = (at: number) => Number(view.getBigUint64(at, true));
  const tileTypeCode = head[99]!;
  const tileType = TILE_TYPES[tileTypeCode] ?? 'unknown';
  const e7 = (at: number) => view.getInt32(at, true) / 1e7;
  const bounds: [number, number, number, number] = [e7(102), e7(106), e7(110), e7(114)];
  const facts: PmtilesFacts = {
    format: 'pmtiles',
    byteLength: buffer.byteLength,
    version,
    tileType,
    vector: tileType === 'MVT' || tileType === 'MLT',
    minZoom: head[100]!,
    maxZoom: head[101]!,
    ...(bounds.some((v) => v !== 0) ? { bounds } : {}),
    layers: [],
  };
  const offset = u64(24);
  const length = u64(32);
  if (length > 0 && length <= 16 * MB && offset + length <= buffer.byteLength) {
    try {
      const raw = await bytes(buffer, offset, offset + length);
      const compression = head[97];
      const zstd = (zlib as { zstdDecompressSync?: (b: Uint8Array) => Buffer }).zstdDecompressSync;
      const text =
        compression === 2
          ? gunzipSync(raw)
          : compression === 3
            ? brotliDecompressSync(raw)
            : compression === 4 && zstd
              ? zstd(raw)
              : compression === 1 || compression === 0
                ? Buffer.from(raw)
                : undefined;
      if (text) {
        const metadata = JSON.parse(text.toString('utf-8')) as { vector_layers?: { id?: unknown }[] };
        facts.layers = (metadata.vector_layers ?? []).map((l) => l?.id).filter((id): id is string => typeof id === 'string');
      }
    } catch {
      // Metadata that can't be read leaves the layers unknown; the header facts stand.
    }
  }
  return facts;
}

const GEOMETRY_TYPE = /"type"\s*:\s*"(Point|MultiPoint|LineString|MultiLineString|Polygon|MultiPolygon|GeometryCollection)"/g;
const FEATURE_TYPE = /"type"\s*:\s*"Feature"/g;
const FIRST_POSITION = /"coordinates"\s*:\s*[\s[]*(-?[\d.]+(?:[eE][-+]?\d+)?)\s*,\s*(-?[\d.]+(?:[eE][-+]?\d+)?)/g;

/** The CRS a GeoJSON text declares or implies: its legacy `crs` member, else coordinates past ±180 / ±90. */
function geojsonCrs(text: string): { crs?: string; lonLat: boolean } {
  const named = /"crs"\s*:\s*\{[^}]*?"name"\s*:\s*"([^"]+)"/.exec(text.slice(0, 64 * 1024))?.[1];
  if (named && !/CRS84|EPSG:+4326$/i.test(named)) {
    const epsg = /EPSG:+(\d+)$/i.exec(named)?.[1];
    return { crs: epsg ? `EPSG:${epsg}` : named, lonLat: false };
  }
  FIRST_POSITION.lastIndex = 0;
  for (let i = 0, m: RegExpExecArray | null; i < 1000 && (m = FIRST_POSITION.exec(text)); i++) {
    if (Math.abs(Number(m[1])) > 180 || Math.abs(Number(m[2])) > 90) return { crs: 'a projected CRS', lonLat: false };
  }
  return { ...(named ? { crs: 'EPSG:4326' } : {}), lonLat: true };
}

function typesIn(text: string): string[] {
  const types = new Set<string>();
  for (const m of text.matchAll(GEOMETRY_TYPE)) types.add(m[1]!);
  return [...types];
}

/** An estimate to three significant figures: 1,477,238 → 1,480,000. */
function roughly(n: number): number {
  const scale = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(n, 1))) - 2);
  return Math.round(n / scale) * scale;
}

/** A GeoJSON file's facts: parsed in full up to the limit, estimated from a sample above it. */
async function geojsonFacts(buffer: AsyncBuffer, name: string, options: PrepareOptions): Promise<GeoJsonFacts> {
  const limit = options.fullParseBytes ?? FULL_PARSE_BYTES;
  const size = buffer.byteLength;
  if (size > limit) {
    const sampled = Math.min(size, options.sampleBytes ?? SAMPLE_BYTES);
    const text = new TextDecoder().decode(await bytes(buffer, 0, sampled));
    const inSample = text.match(FEATURE_TYPE)?.length ?? 0;
    if (inSample === 0) {
      throw new PrepareError(
        `${name}: no GeoJSON features in its first ${formatBytes(sampled)}, so their number can't be estimated. ` +
          'Is it a FeatureCollection?',
        EXIT_CODES.VALIDATION_ERROR,
      );
    }
    return {
      format: 'geojson',
      byteLength: size,
      features: roughly((inSample * size) / sampled),
      estimated: true,
      sampledBytes: sampled,
      geometryTypes: typesIn(text),
      ...geojsonCrs(text),
    };
  }
  const text = new TextDecoder().decode(await bytes(buffer, 0, size));
  let data: unknown;
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    throw new PrepareError(`${name} is not valid JSON (${(error as Error).message}).`, EXIT_CODES.VALIDATION_ERROR);
  }
  const d = data as { type?: unknown; features?: unknown; geometry?: { type?: unknown } | null };
  type Feature = { geometry?: { type?: unknown } | null };
  let features: Feature[];
  if (d && d.type === 'FeatureCollection' && Array.isArray(d.features)) features = d.features as Feature[];
  else if (d && d.type === 'Feature') features = [d as Feature];
  else {
    throw new PrepareError(`${name} is JSON but not GeoJSON features (a FeatureCollection or a Feature).`, EXIT_CODES.VALIDATION_ERROR);
  }
  const types = new Set<string>();
  for (const f of features) if (typeof f?.geometry?.type === 'string') types.add(f.geometry.type);
  return {
    format: 'geojson',
    byteLength: size,
    features: features.length,
    estimated: false,
    geometryTypes: [...types],
    ...geojsonCrs(text),
  };
}

// ---------------------------------------------------------------------------
// The route: the guide's size-to-format table
// ---------------------------------------------------------------------------

type Kind = 'points' | 'lines' | 'polygons' | 'mixed';

/** Points, lines or polygons, from geometry type names ("MultiPolygon Z" → polygons). */
function kindOf(types: string[]): Kind {
  const kinds = new Set(
    types.map((t) => {
      const base = t.replace(/\s*Z?M?$/i, '').replace(/^Multi/, '');
      return base === 'Point' ? 'points' : base === 'LineString' ? 'lines' : base === 'Polygon' ? 'polygons' : 'mixed';
    }),
  );
  return kinds.size === 1 ? ([...kinds][0] as Kind) : 'mixed';
}

/** A file next to `file` (same folder or URL path), named `name`. */
function sibling(file: string, name: string): string {
  if (!isUrl(file)) return name;
  const path = file.replace(/[?#].*$/, '');
  return path.slice(0, path.lastIndexOf('/') + 1) + name;
}

/** The `url:` for a file: the URL itself, or a local file's name (relative to the map document). */
function urlFor(file: string): string {
  return isUrl(file) ? file.replace(/[?#].*$/, '') : fileNameOf(file);
}

/** A source id from a file name: "lots-overviews.parquet" → "lots_overviews". */
function sourceId(file: string): string {
  const name = fileNameOf(file);
  const dot = name.indexOf('.');
  return (dot > 0 ? name.slice(0, dot) : name).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'data';
}

/** A YAML scalar, quoted when plain style would misread it. */
function yamlString(value: string): string {
  return /^[A-Za-z0-9_./:@~%+-]+$/.test(value) && !/^[-?:@%]/.test(value) && !/: /.test(value) ? value : JSON.stringify(value);
}

interface SourceBlock {
  id: string;
  type: 'geojson' | 'vector' | 'raster';
  url: string;
  load?: { value: string; comment: string };
  extra?: string[];
}

function sourceYaml(block: SourceBlock): string {
  const lines = ['sources:', `  ${block.id}:`, `    type: ${block.type}`, `    url: ${yamlString(block.url)}`];
  if (block.load) lines.push(`    load: ${block.load.value}   # ${block.load.comment}`);
  for (const line of block.extra ?? []) lines.push(`    ${line}`);
  return lines.join('\n') + '\n';
}

const BY_VIEW_LOAD = { value: 'viewport', comment: 'only the features in view; nothing below zoom 10 (minzoom)' };
const OVERVIEW_LOAD = { value: 'viewport', comment: 'the overview level that fits the zoom (experimental)' };
const OVERVIEW_NOTE =
  'Reading overview levels by zoom is experimental in 0.10 (the geo:overviews spec is a draft); ' +
  '`load: { mode: viewport, overviews: false }` reads full detail only.';

/** The facts the table needs, the same for every format. */
interface Shape {
  format: Exclude<Detected, 'pmtiles'>;
  features: number;
  kind: Kind;
  lonLat: boolean;
  crs?: string;
  /** GeoParquet: WKB geometry (what this version reads). */
  wkb: boolean;
  /** Ready to read by view: a GeoParquet sorted with a bbox column and modest row groups; an indexed FlatGeobuf. */
  byView: boolean;
  /** Why not, in a few words. */
  notByView?: string;
  overviews?: GeoParquetFacts['overviews'];
}

function shapeOf(facts: Exclude<FileFacts, PmtilesFacts>): Shape {
  if (facts.format === 'geoparquet') {
    const notByView = !facts.bboxColumn
      ? 'it has no bbox column'
      : facts.spatialOrder === 'unsorted'
        ? "its rows aren't sorted by location"
        : facts.rowsPerRowGroup.max > LARGE_ROW_GROUP
          ? `its row groups are large (up to ${count(facts.rowsPerRowGroup.max)} rows; about 10,000 reads well)`
          : facts.spatialOrder === 'unknown' && facts.rowGroups > 1
            ? "its row groups don't record their extents"
            : undefined;
    return {
      format: 'geoparquet',
      features: facts.rows,
      kind: kindOf(facts.geometryTypes),
      lonLat: facts.lonLat,
      ...(facts.crs ? { crs: facts.crs } : {}),
      wkb: facts.encoding.toUpperCase() === 'WKB',
      byView: !notByView,
      ...(notByView ? { notByView } : {}),
      ...(facts.overviews ? { overviews: facts.overviews } : {}),
    };
  }
  if (facts.format === 'flatgeobuf') {
    return {
      format: 'flatgeobuf',
      features: facts.features,
      kind: kindOf([facts.geometryType]),
      lonLat: facts.lonLat,
      ...(facts.crs ? { crs: facts.crs } : {}),
      wkb: true,
      byView: facts.indexed,
      ...(facts.indexed ? {} : { notByView: 'it has no spatial index' }),
    };
  }
  return {
    format: 'geojson',
    features: facts.features,
    kind: kindOf(facts.geometryTypes),
    lonLat: facts.lonLat,
    ...(facts.crs ? { crs: facts.crs } : {}),
    wkb: true,
    byView: false,
    notByView: 'GeoJSON is always read whole',
  };
}

const EXT: Record<Shape['format'], string> = { geoparquet: 'parquet', flatgeobuf: 'fgb', geojson: 'geojson' };
const stemOf = (file: string, shape: Shape) => commandStem(file, EXT[shape.format]);

/** tylertoo's overview levels for a GeoParquet file: the first half of core's PMTiles recipe. */
function overviewCommand(file: string): string {
  const stem = commandStem(file, 'parquet');
  return (
    `uv run --with tylertoo==0.8.0 python -c "import tylertoo as t; t.overview('${fileNameOf(file)}', ` +
    `'${stem}-ov.parquet', min_zoom=0, max_zoom=14, collapse_square=True)"`
  );
}

/** GeoJSON or FlatGeobuf to GeoParquet, Hilbert-sorted with a bbox column (the GeoParquet guide's command). */
function toParquetCommand(file: string, rowGroups = true): string {
  return (
    `uvx --from geoparquet-io==1.7.0 gpio convert geoparquet ${fileNameOf(file)} ${commandStem(file, 'fgb')}.parquet` +
    (rowGroups ? ' --row-group-size 10000' : '')
  );
}

/** The overview-file route from `file`: convert to GeoParquet first unless it is one. */
function overviewRoute(file: string, shape: Shape): { commands: string[]; output: string } {
  const stem = stemOf(file, shape);
  if (shape.format === 'geoparquet') return { commands: [overviewCommand(file)], output: `${stem}-ov.parquet` };
  const parquet = sibling(file, `${stem}.parquet`);
  return { commands: [toParquetCommand(file, false), overviewCommand(parquet)], output: `${stem}-ov.parquet` };
}

function pmtilesRoute(file: string, shape: Shape): { commands: string[]; output: string; layer: string } {
  const stem = stemOf(file, shape);
  return { commands: shellCommands(pmtilesCommand(file, shape.format)), output: `${stem}.pmtiles`, layer: stem };
}

/** The recommendation for a PMTiles archive: it is already tiles. */
function tilesRecommendation(facts: PmtilesFacts, file: string): Recommendation {
  const id = sourceId(file);
  const notes: string[] = [];
  if (facts.vector) {
    notes.push(
      facts.layers.length > 0
        ? `Each layer picks one of its tile layers with source-layer: ${facts.layers.join(' or ')}.`
        : 'Each layer names one of its tile layers with source-layer: (the archive lists none in its metadata).',
    );
    if (facts.tileType === 'MLT') notes.push('Its tiles are MLT (MapLibre Tiles): maplibre-gl 6 or later draws them, and maplibre-yaml sets `encoding: mlt` from the header.');
  } else {
    notes.push('Raster tiles: for elevation tiles (terrain, hillshade), write type: raster-dem instead.');
  }
  notes.push(`MapLibre draws it from zoom ${facts.minZoom} to ${facts.maxZoom}, and overzooms past ${facts.maxZoom}.`);
  return {
    verdict: 'no-change',
    route: 'tiles',
    summary: 'No change needed: PMTiles is already tiles, drawn at every zoom.',
    steps: [],
    yaml: sourceYaml({
      id,
      type: facts.vector ? 'vector' : 'raster',
      url: urlFor(file),
      ...(facts.vector ? {} : { extra: ['tileSize: 256                 # most raster archives use 256-pixel tiles'] }),
    }),
    notes,
  };
}

/**
 * The guide's route for a file, from its facts: the commands to run (fixes
 * first), the YAML for the file they produce, and an alternative where one
 * fits. Pure: `mlym prepare` prints it; tests call it with any facts.
 *
 * @param facts - What {@link readFacts} returned (or a test's facts).
 * @param file - The path or URL as given: commands use its file name, the YAML its URL.
 */
export function recommend(facts: FileFacts, file: string): Recommendation {
  if (facts.format === 'pmtiles') return tilesRecommendation(facts, file);
  const shape = shapeOf(facts);
  const id = sourceId(file);
  const steps: PrepareStep[] = [];
  const notes: string[] = [];
  let current = file;
  let ready = shape.byView;
  let notByView = shape.notByView;

  // Fixes first: what this version can't draw at all.
  if (!shape.lonLat || !shape.wkb) {
    const ext = EXT[shape.format];
    const stem = stemOf(file, shape);
    const out = `${stem}-${shape.lonLat ? 'wkb' : '4326'}.${ext}`;
    const name = fileNameOf(file);
    const why: string[] = [];
    let command: string;
    if (!shape.lonLat) {
      why.push(`It is in ${shape.crs ?? 'a projected CRS'}; MapLibre needs longitude/latitude (EPSG:4326). Reproject it`);
      command = `ogr2ogr -t_srs EPSG:4326${shape.wkb ? '' : ' -f Parquet -lco GEOMETRY_ENCODING=WKB'} ${out} ${name}`;
    } else {
      why.push("Its geometry is GeoArrow, which maplibre-yaml doesn't read yet; rewrite it with WKB geometry");
      command = `ogr2ogr -f Parquet -lco GEOMETRY_ENCODING=WKB ${out} ${name}`;
    }
    steps.push({ why: `${why.join('')}:`, commands: [command] });
    current = sibling(file, out);
    // ogr2ogr writes a FlatGeobuf with an index, but doesn't sort a GeoParquet file by location.
    ready = shape.format === 'flatgeobuf';
    if (!ready) notByView = "the rewritten file isn't sorted by location";
  }

  const features = shape.features;
  const noun = { points: ['point', 'points'], lines: ['line', 'lines'], polygons: ['polygon', 'polygons'], mixed: ['feature', 'features'] }[shape.kind];
  const estimated = facts.format === 'geojson' && facts.estimated;
  const many = `${estimated ? 'About ' : ''}${count(features)} ${features === 1 ? noun[0] : noun[1]}`;

  // A file already carrying overview levels: the author chose that deliverable.
  if (shape.overviews) {
    notes.push(OVERVIEW_NOTE);
    if (!shape.overviews.known) {
      notes.push(
        `Its geo:overviews version (${shape.overviews.version}) is newer than this version reads, ` +
          'so the map reads its full-detail level only.',
      );
    }
    const big = features >= AS_IS_FEATURES;
    return finish({
      route: big ? 'by-view' : 'as-is',
      summary: big
        ? `An overview file: read by view, the map reads the level that fits the zoom.`
        : `An overview file; at ${count(features)} rows of full detail the map reads its full-detail level whole. ` +
          'With load: viewport it reads the level that fits the zoom instead.',
      yaml: sourceYaml({ id, type: 'geojson', url: urlFor(current), ...(big ? { load: OVERVIEW_LOAD } : {}) }),
    });
  }

  if (features < AS_IS_FEATURES) {
    const rec = finish({
      route: 'as-is',
      summary: `${many}, under ${count(AS_IS_FEATURES)}: the map reads it whole.`,
      yaml: sourceYaml({ id, type: 'geojson', url: urlFor(current) }),
    });
    // A by-view tip only for a file that is fine as it is: after a fix step it would be noise.
    if (!ready && steps.length === 0 && shape.format !== 'geojson') {
      const fix = byViewFix(current, shape, notByView);
      rec.alternative = {
        why: `Only to read it by view (load: viewport), which this size doesn't need: ${notByView}.`,
        commands: fix.commands,
        yaml: sourceYaml({ id, type: 'geojson', url: urlFor(sibling(file, fix.output)), load: BY_VIEW_LOAD }),
      };
    }
    return rec;
  }

  if (features <= BY_VIEW_FEATURES) {
    let target = current;
    if (!ready) {
      const fix = byViewFix(current, shape, notByView);
      steps.push({ why: fix.why, commands: fix.commands });
      target = sibling(file, fix.output);
    }
    const rec = finish({
      route: 'by-view',
      summary:
        `${many}, between ${count(AS_IS_FEATURES)} and ${count(BY_VIEW_FEATURES)}: ` +
        (shape.format === 'flatgeobuf' ? 'an indexed FlatGeobuf' : 'a sorted GeoParquet file with a bbox column') +
        ', read by view (only what is on screen).',
      yaml: sourceYaml({ id, type: 'geojson', url: urlFor(target), load: BY_VIEW_LOAD }),
    });
    if (shape.kind === 'polygons' || shape.kind === 'mixed') {
      const tiles = pmtilesRoute(current, shape);
      rec.alternative = {
        why: 'For a dense polygon fabric (parcels, building footprints) seen citywide, PMTiles draws at every zoom:',
        commands: tiles.commands,
        yaml: tilesYaml(id, sibling(file, tiles.output), tiles.layer),
      };
    }
    return rec;
  }

  // Above 250,000: tiles for polygons, an overview file for points and lines.
  const tiles = pmtilesRoute(current, shape);
  const overview = overviewRoute(current, shape);
  const overviewYaml = sourceYaml({ id, type: 'geojson', url: urlFor(sibling(file, overview.output)), load: OVERVIEW_LOAD });
  const pmtilesYaml = tilesYaml(id, sibling(file, tiles.output), tiles.layer);
  notes.push(OVERVIEW_NOTE);
  if (shape.kind === 'points' || shape.kind === 'lines') {
    steps.push({
      why: `Write overview levels (simplified copies for coarser zooms) into one GeoParquet file with tylertoo:`,
      commands: overview.commands,
    });
    return finish({
      route: 'overviews',
      summary:
        `${many}, over ${count(BY_VIEW_FEATURES)}: more ${shape.kind} than a view reads well at full detail. ` +
        'An overview GeoParquet file (experimental) reads a level that fits each zoom.',
      yaml: overviewYaml,
      alternative: { why: 'Or PMTiles, drawn at every zoom (not experimental):', commands: tiles.commands, yaml: pmtilesYaml },
    });
  }
  steps.push({
    why: 'Convert it to PMTiles with tylertoo (the parcel recipe; MapLibre draws zoom 14’s tiles further in):',
    commands: tiles.commands,
  });
  return finish({
    route: 'pmtiles',
    summary:
      `${many}, over ${count(BY_VIEW_FEATURES)}: ` +
      'PMTiles draws it at every zoom, citywide included.',
    yaml: pmtilesYaml,
    alternative: {
      why: 'Or, to publish one GeoParquet file: an overview file (experimental), read by view at the level that fits the zoom:',
      commands: overview.commands,
      yaml: overviewYaml,
    },
  });

  function finish(parts: Omit<Recommendation, 'verdict' | 'steps' | 'notes'>): Recommendation {
    if (isUrl(file) && steps.length > 0) {
      notes.push('The commands read and write local files: download the file first, and upload what they write beside it.');
    }
    return {
      verdict: steps.length === 0 ? 'no-change' : 'change',
      steps,
      notes,
      ...parts,
      summary: steps.length === 0 ? `No change needed. ${parts.summary}` : parts.summary,
    };
  }
}

/** What makes `file` readable by view, and the file it writes. */
function byViewFix(file: string, shape: Shape, reason: string | undefined): { why: string; commands: string[]; output: string } {
  const stem = stemOf(file, shape);
  if (shape.format === 'geoparquet') {
    return {
      why:
        `Make it readable by view (${reason ?? 'its rows need sorting'}): rows sorted along a Hilbert curve, ` +
        'a bbox column, about 10,000 rows per row group:',
      commands: shellCommands(sortedParquetCommand(file)),
      output: `${stem}-hilbert.parquet`,
    };
  }
  if (shape.format === 'flatgeobuf') {
    return {
      why: 'Re-create it with a spatial index, which reading by view needs:',
      commands: shellCommands(indexedFlatGeobufCommand(file)),
      output: `${stem}-indexed.fgb`,
    };
  }
  return {
    why: 'Convert it to GeoParquet, Hilbert-sorted with a bbox column, to read by view:',
    commands: [toParquetCommand(file)],
    output: `${stem}.parquet`,
  };
}

function tilesYaml(id: string, url: string, layer: string): string {
  return sourceYaml({ id, type: 'vector', url: urlFor(url), extra: [`# layers draw it with source-layer: ${layer}`] });
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/**
 * Read a file and recommend what to do with it.
 *
 * @remarks
 * Kept separate from the command so it is testable without a process exit;
 * a refusal throws {@link PrepareError} carrying its exit code.
 */
export async function prepareFile(file: string, options: PrepareOptions = {}): Promise<PrepareReport> {
  const target = isUrl(file) ? file : resolve(file);
  const facts = await readFacts(target, options);
  return { file: target, facts, recommendation: recommend(facts, target) };
}

function crsLine(crs: string | undefined, lonLat: boolean): string {
  if (lonLat) return `${crs ?? 'EPSG:4326'} (longitude/latitude)`;
  return `${crs ?? 'a projected CRS'} (projected: needs reprojecting to EPSG:4326)`;
}

/** The facts, as aligned "label  value" lines. */
function factLines(facts: FileFacts): [string, string][] {
  switch (facts.format) {
    case 'geoparquet': {
      const rows: [string, string][] = [];
      const ov = facts.overviews;
      rows.push([
        'rows',
        ov ? `${count(facts.rows)} at full detail (${count(facts.totalRows)} in the file, every level)` : count(facts.rows),
      ]);
      rows.push([
        'geometry',
        `${facts.geometryTypes.join(', ') || 'not declared'} (${facts.encoding}${facts.encoding.toUpperCase() === 'WKB' ? '' : ', GeoArrow'}), column ${facts.geometryColumn}`,
      ]);
      rows.push(['CRS', crsLine(facts.crs, facts.lonLat)]);
      rows.push(['bbox column', facts.bboxColumn ?? 'none']);
      const { min, max } = facts.rowsPerRowGroup;
      rows.push([
        'row groups',
        `${count(facts.rowGroups)}${ov ? ' at full detail' : ''}, ${min === max ? `${plural(min, 'row')} each` : `${count(min)}–${count(max)} rows each`}`,
      ]);
      rows.push([
        'sort order',
        facts.spatialOrder === 'sorted'
          ? 'sorted by location (row groups cover separate areas)'
          : facts.spatialOrder === 'unsorted'
            ? 'not sorted by location (row groups each span most of the area)'
            : `unknown (${!facts.bboxColumn ? 'no bbox column' : facts.rowGroups < 2 ? 'one row group' : 'no row-group extents'})`,
      ]);
      if (facts.compression.length > 0) rows.push(['compression', facts.compression.join(', ')]);
      if (ov) {
        rows.push([
          'overviews',
          `geo:overviews ${ov.version}, ${ov.mode}, ${plural(ov.levels.length, 'level')} (reading them is experimental)`,
        ]);
        ov.levels.forEach((level, i) => {
          const at = level.zoom !== undefined ? `z${level.zoom}` : level.gsd !== undefined ? `${level.gsd.toFixed(2)} m/px` : `level ${i}`;
          rows.push([
            '',
            `${at.padEnd(5)} ${plural(level.rows, 'row')}, ${plural(level.rowGroups, 'row group')}` +
              (i === ov.canonicalLevel ? ' (full detail)' : ''),
          ]);
        });
      }
      return rows;
    }
    case 'flatgeobuf':
      return [
        ['features', count(facts.features)],
        ['geometry', facts.geometryType],
        ['CRS', crsLine(facts.crs, facts.lonLat)],
        ['spatial index', facts.indexed ? `yes (node size ${facts.nodeSize})` : 'no spatial index'],
      ];
    case 'geojson':
      return [
        [
          'features',
          facts.estimated
            ? `about ${count(facts.features)} (an estimate, from the first ${formatBytes(facts.sampledBytes ?? 0)}: ` +
              `the file is over the ${formatBytes(FULL_PARSE_BYTES)} it parses in full)`
            : count(facts.features),
        ],
        ['geometry', facts.geometryTypes.join(', ') || 'none'],
        ['CRS', crsLine(facts.crs, facts.lonLat)],
      ];
    case 'pmtiles':
      return [
        ['tiles', `${facts.tileType}${facts.vector ? ' (vector)' : ' (raster)'}, PMTiles v${facts.version}`],
        ['zooms', `${facts.minZoom}–${facts.maxZoom}`],
        ...(facts.bounds ? [['bounds', `[${facts.bounds.join(', ')}]`] as [string, string]] : []),
        ...(facts.vector ? [['layers', facts.layers.join(', ') || 'none listed'] as [string, string]] : []),
      ];
  }
}

/** The report as text: facts, the recommendation and its commands, the YAML to paste. */
export function formatPrepare(report: PrepareReport): string {
  const { facts, recommendation: rec } = report;
  const label = facts.format === 'geoparquet' ? 'GeoParquet' : FORMAT_NAMES[facts.format];
  const out: string[] = [`${fileNameOf(report.file)}: ${label}, ${formatBytes(facts.byteLength)}`];
  const lines = factLines(facts);
  const width = Math.max(...lines.map(([k]) => k.length));
  for (const [k, v] of lines) out.push(`  ${k.padEnd(width)}  ${v}`);
  out.push('', rec.summary);
  if (rec.steps.length > 0) {
    out.push('', 'Run:');
    rec.steps.forEach((step, i) => {
      out.push('', `  ${rec.steps.length > 1 ? `${i + 1}. ` : ''}${step.why}`);
      for (const command of step.commands) out.push(`     ${command}`);
    });
    out.push('', 'Then paste:');
  } else {
    out.push('', 'Paste:');
  }
  out.push('', rec.yaml.trimEnd(), '');
  if (rec.alternative) {
    out.push(rec.alternative.why);
    for (const command of rec.alternative.commands) out.push(`     ${command}`);
    out.push('', rec.alternative.yaml.trimEnd(), '');
  }
  for (const note of rec.notes) out.push(`Note: ${note}`);
  out.push(`More: ${GUIDE}`);
  return out.join('\n') + '\n';
}

/** `--format` values; `human` is accepted as `text`, as `validate` spells it. */
const OUTPUT_FORMATS = ['text', 'json', 'human'] as const;

export const prepareCommand = defineCommand({
  meta: {
    name: 'prepare',
    description:
      'Report a data file’s facts and print the one command that makes it draw well, and the YAML source to paste (reads only; writes nothing)',
  },
  args: {
    file: {
      type: 'positional',
      required: false,
      description: 'A local path or http(s) URL: .parquet, .fgb, .geojson/.json or .pmtiles',
    },
    format: {
      type: 'string',
      alias: 'f',
      default: 'text',
      description: 'Output format: text, or json',
    },
  },
  async run({ args }) {
    const outputFormat = String(args.format ?? 'text').toLowerCase();
    const json = outputFormat === 'json';
    const fail = (exitCode: number, message: string): never => {
      if (json) process.stdout.write(JSON.stringify({ success: false, errors: [{ message }] }, null, 2) + '\n');
      else for (const line of message.split('\n')) logger.error(line);
      return process.exit(exitCode);
    };
    if (!(OUTPUT_FORMATS as readonly string[]).includes(outputFormat)) {
      fail(EXIT_CODES.VALIDATION_ERROR, `--format must be text or json, not "${String(args.format)}".`);
    }
    if (!args.file) {
      fail(EXIT_CODES.VALIDATION_ERROR, 'Name a data file or URL: mlym prepare <file>.');
    }
    let report: PrepareReport;
    try {
      report = await prepareFile(String(args.file));
    } catch (error) {
      if (error instanceof PrepareError) return fail(error.exitCode, error.message);
      return fail(EXIT_CODES.UNKNOWN_ERROR, `mlym prepare failed: ${(error as Error).message}`);
    }
    if (json) {
      process.stdout.write(JSON.stringify({ success: true, ...report }, null, 2) + '\n');
      return;
    }
    process.stdout.write(formatPrepare(report));
  },
});
