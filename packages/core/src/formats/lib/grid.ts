/**
 * @file The grid source's decoders and sampler, as the `grid` on-demand chunk (grid source, U2)
 * @module @maplibre-yaml/core/formats/lib/grid
 *
 * @description
 * A `type: grid` source is a regular raster field on a longitude/latitude
 * grid — elevation, temperature, density, a current, any scalar or vector
 * field — that page code reads as numbers rather than MapLibre draws. This
 * chunk (`chunks/grid.js`) turns a downloaded file into a {@link GridField}
 * for every supported `encoding:`:
 *
 * - `rg-uv` and `scalar-r`: an 8-bit PNG (./png) whose red and green bytes
 *   are the two components, or whose red byte is the value, scaled by the
 *   document's `range:`. The decoded bytes are retained: a `range:` change
 *   under a live document is a new field with no decode ({@link GridField.rescale}).
 * - `nullschool-json`: one or two `{ header, data }` records (the grib2json
 *   shape), physical values, geometry from the header.
 * - `geotiff`: one or two bands of a whole GeoTIFF in EPSG:4326, read with
 *   the COG chunk's band reader (formats/lib/geotiff-bands) through the
 *   host's decoder seam, so geotiff.js is bundled once.
 *
 * Both authored geometries normalize to node geometry: `grid:` names the
 * nodes directly; `bounds:` names the cell edges and takes the counts from
 * the image. `wraps` is inferred, never assumed: the columns span the globe
 * (within half a cell), or span it plus one duplicated column. Missing data
 * is the union of the document's `nodata:` rule and the encoding's own
 * marker (alpha 0, a JSON `null`, the GeoTIFF nodata tag); a node any rule
 * marks is missing, and a sample touching one is `null`.
 *
 * Imports core as types only; what it needs from core — the plain-language
 * failure, the seam, the size guards — comes in as a {@link GridHost}
 * (renderer/grid-host.ts). Every failure is a `FormatFailure` of format
 * `grid`, worded by the message catalogue in the main bundle.
 */

import type { GridSource } from "../../schemas/source.schema";
import type { FormatFailure } from "../errors";
import type {
  GridField,
  GridGeometry,
  GridHost,
  GridLoadHost,
  GridPosition,
  ScalarGridField,
  VectorGridField,
  VectorSample,
} from "../../renderer/grid-host";
import { decodePng, PngError, readPngHeader } from "./png";

export type { GridField, GridGeometry, GridHost, GridLoadHost, GridPosition, ScalarGridField, VectorGridField, VectorSample };

/**
 * Cells (`nx * ny`) above which a grid isn't decoded: a 0.25° global grid is
 * about a million; this is sixteen of them — past it, decoding and holding
 * the field would stall a page. Read from the file's header before anything
 * is inflated or parsed. Tests pass a smaller one through the host.
 */
export const GRID_MAX_CELLS = 16_000_000;

// ---------------------------------------------------------------------------
// The decoded representation
// ---------------------------------------------------------------------------

/** What a decode produces, and what a field is built over (shared by a rescaled field). */
interface Decoded {
  geometry: GridGeometry;
  /** Components: 1 (scalar) or 2 (vector). */
  components: 1 | 2;
  /** One byte per node, 1 = missing. */
  missing: Uint8Array;
  /** Byte encodings: the image's channel bytes, interleaved; component `c` is channel `c`. */
  bytes?: { data: Uint8Array; channels: number };
  /** Physical encodings: one array per component. */
  floats?: Float32Array[];
}

/** The nodes' edges, `[west, south, east, north]`. */
function boundsOf(g: GridGeometry): [number, number, number, number] {
  return [g.lo1 - g.dx / 2, g.la1 - (g.ny - 1) * g.dy - g.dy / 2, g.lo1 + (g.nx - 1) * g.dx + g.dx / 2, g.la1 + g.dy / 2];
}

/**
 * The number of columns a wrapping grid repeats after: `nx` when the columns
 * span the globe (within half a cell), `nx - 1` when they span the globe plus
 * one duplicated column, 0 when the grid doesn't wrap.
 */
function wrapPeriod(g: GridGeometry): number {
  const half = g.dx / 2;
  if (Math.abs(g.nx * g.dx - 360) <= half) return g.nx;
  if (g.nx > 1 && Math.abs((g.nx - 1) * g.dx - 360) <= half) return g.nx - 1;
  return 0;
}

// ---------------------------------------------------------------------------
// The field
// ---------------------------------------------------------------------------

/** The position's longitude and latitude, or undefined when it isn't a finite pair. */
function lngLatOf(position: GridPosition): [number, number] | undefined {
  const lng = Array.isArray(position) ? position[0] : (position as { lng: number }).lng;
  const lat = Array.isArray(position) ? position[1] : (position as { lat: number }).lat;
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng as number, lat as number] : undefined;
}

/** The slop allowed when a position lands on the last column by arithmetic alone. */
const EDGE_EPSILON = 1e-9;

/**
 * Build the immutable field over a decode. `range` is the values bytes 0 and
 * 255 stand for (byte encodings); a rescale builds another field over the
 * same decode with another range.
 */
/**
 * What each field was built from, so {@link refitGrid} can hand out the same
 * data under another `range:` or `units:` with no decode. Weak: a field page
 * code drops takes its bytes with it.
 */
const DECODED = new WeakMap<GridField, Decoded>();

function makeField(d: Decoded, units: string | undefined, range: readonly [number, number] | undefined): GridField {
  const geometry = Object.freeze({ ...d.geometry });
  const { nx, ny, lo1, la1, dx, dy } = geometry;
  const bounds = Object.freeze(boundsOf(geometry));
  const period = wrapPeriod(geometry);
  const wraps = period > 0;
  const globe = 360 / dx;
  const missing = d.missing;
  const bytes = d.bytes;
  const floats = d.floats;
  // Byte encodings: value = lo + byte * scale (applied after blending, which is linear).
  const lo = range?.[0] ?? 0;
  const scale = range ? (range[1] - range[0]) / 255 : 1;

  /** Component `c`'s raw value at node index `i` (a byte, or the physical value). */
  const raw = bytes
    ? (c: number, i: number) => bytes.data[i * bytes.channels + c]!
    : (c: number, i: number) => floats![c]![i]!;
  const unscale = bytes ? (v: number) => lo + v * scale : (v: number) => v;

  /**
   * The four nodes around a position and the blend weights, or false when
   * the position is outside a non-wrapping grid or a contributing node is
   * missing — a node with zero weight (a position exactly on a column or a
   * row) doesn't contribute, so a sample on a node beside a missing one is
   * still that node's value. Written to one reused tuple: sampling
   * allocates nothing.
   */
  const cell = new Float64Array(6); // i00, i10, i01, i11, tx, ty

  /**
   * The fractional column `lng` falls on, or -1 when it lies outside a
   * non-wrapping grid. Any longitude names one place, so it is first brought
   * to the grid's own turn of the globe. The one test of "outside" the
   * field has: `contains` and `locate` both ask it.
   */
  function columnOf(lng: number): number {
    const fx = (lng - lo1) / dx;
    if (wraps) return ((fx % period) + period) % period;
    const turned = ((fx % globe) + globe) % globe;
    if (turned > nx - 1 + EDGE_EPSILON) return -1;
    return turned > nx - 1 ? nx - 1 : turned;
  }

  function locate(position: GridPosition): boolean {
    const lngLat = lngLatOf(position);
    if (!lngLat) return false;
    const fx = columnOf(lngLat[0]);
    if (fx < 0) return false;
    const fy = Math.min(Math.max((la1 - lngLat[1]) / dy, 0), ny - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = wraps ? (x0 + 1) % period : Math.min(x0 + 1, nx - 1);
    const y1 = Math.min(y0 + 1, ny - 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const i00 = y0 * nx + x0;
    const i10 = y0 * nx + x1;
    const i01 = y1 * nx + x0;
    const i11 = y1 * nx + x1;
    if (missing[i00]) return false;
    if (tx > 0 && missing[i10]) return false;
    if (ty > 0 && (missing[i01] || (tx > 0 && missing[i11]))) return false;
    cell[0] = i00;
    cell[1] = i10;
    cell[2] = i01;
    cell[3] = i11;
    cell[4] = tx;
    cell[5] = ty;
    return true;
  }

  /** Component `c` blended over the located cell, unscaled. A zero weight reads nothing (the node may be missing). */
  function blend(c: number): number {
    const tx = cell[4]!;
    const ty = cell[5]!;
    const top = tx > 0 ? raw(c, cell[0]!) * (1 - tx) + raw(c, cell[1]!) * tx : raw(c, cell[0]!);
    if (ty === 0) return unscale(top);
    const bottom = tx > 0 ? raw(c, cell[2]!) * (1 - tx) + raw(c, cell[3]!) * tx : raw(c, cell[2]!);
    return unscale(top * (1 - ty) + bottom * ty);
  }

  /** Every node of component `c`, unscaled, NaN where missing. */
  function materialize(c: number): Float32Array {
    const out = new Float32Array(nx * ny);
    for (let i = 0; i < out.length; i++) out[i] = missing[i] ? NaN : unscale(raw(c, i));
    return out;
  }

  const base = {
    units,
    bounds,
    grid: geometry,
    wraps,
    nx,
    ny,
    range: range ? (Object.freeze([range[0], range[1]]) as readonly [number, number]) : undefined,
    isMissing: (col: number, row: number) => col < 0 || row < 0 || col >= nx || row >= ny || missing[row * nx + col] === 1,
    contains(position: GridPosition): boolean {
      const lngLat = lngLatOf(position);
      return lngLat !== undefined && columnOf(lngLat[0]) >= 0;
    },
    rescale(next: readonly [number, number]): GridField {
      if (!bytes) throw new Error("maplibre-yaml: this grid carries physical values, so it has no range: to change");
      return makeField(d, units, next);
    },
  };

  if (d.components === 2) {
    let cached: { u: Float32Array; v: Float32Array; missing: Uint8Array } | undefined;
    const field: VectorGridField = {
      ...base,
      kind: "vector",
      sample(position: GridPosition): VectorSample | null {
        if (!locate(position)) return null;
        const u = blend(0);
        const v = blend(1);
        return { u, v, speed: Math.hypot(u, v) };
      },
      // The mask is copied: page code may write to what values() hands out, and the field's own must stay as decoded.
      values: () => (cached ??= { u: materialize(0), v: materialize(1), missing: missing.slice() }),
    };
    DECODED.set(field, d);
    return Object.freeze(field);
  }
  let cached: { value: Float32Array; missing: Uint8Array } | undefined;
  const field: ScalarGridField = {
    ...base,
    kind: "scalar",
    sample: (position: GridPosition): number | null => (locate(position) ? blend(0) : null),
    values: () => (cached ??= { value: materialize(0), missing: missing.slice() }),
  };
  DECODED.set(field, d);
  return Object.freeze(field);
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

type Fail = (failure: Omit<FormatFailure, "format" | "url">) => never;

/** The image's node geometry from the document's `grid:` or `bounds:`. */
function imageGeometry(spec: GridSource, width: number, height: number, fail: Fail): GridGeometry {
  if (spec.grid) {
    const { nx, ny, lo1, la1, dx, dy } = spec.grid;
    if (nx !== width || ny !== height) {
      fail({ code: "dimensions", gridSize: { declared: [nx, ny], actual: [width, height] } });
    }
    return { nx, ny, lo1, la1, dx, dy };
  }
  if (spec.bounds) return boundsGeometry(spec.bounds, width, height);
  // The parser requires one of the two; a spec built by hand may lack both.
  return fail({ code: "read", detail: `encoding: ${spec.encoding} needs bounds: or grid: for the image's geometry` });
}

/** Node geometry from cell edges `[west, south, east, north]` and the counts. */
function boundsGeometry([w, s, e, n]: readonly [number, number, number, number], nx: number, ny: number): GridGeometry {
  const dx = (e - w) / nx;
  const dy = (n - s) / ny;
  return { nx, ny, lo1: w + dx / 2, la1: n - dy / 2, dx, dy };
}

/** Refuse a grid of `cells` over the cap, before any decoding. */
function checkCells(cells: number, host: GridHost, fail: Fail): void {
  const cap = host.limits?.cells ?? GRID_MAX_CELLS;
  if (cells > cap) fail({ code: "too-large", cells, limits: { cells: cap } });
}

/**
 * Where channel `letter` sits in a pixel of `channels` interleaved bytes, or
 * -1 when the layout has no such channel: grayscale has `r`; grayscale with
 * alpha `r` and `a`; RGB `r`, `g`, `b`; RGBA all four. Alpha is always the
 * last channel, so a rule on `a` never reads a gray+alpha image's alpha as
 * blue, nor an RGB image's nothing.
 */
function channelIndex(letter: "r" | "g" | "b" | "a", channels: number): number {
  if (letter === "a") return channels === 2 || channels === 4 ? channels - 1 : -1;
  const index = { r: 0, g: 1, b: 2 }[letter];
  return index === 0 || channels >= 3 ? index : -1;
}

/**
 * The missing mask for an image: alpha 0 (when the image has alpha) and the
 * document's `nodata:` rule. A rule naming a channel the layout lacks is an
 * `encoding` failure (the `detail` names the rule, `image.channels` the layout).
 */
function imageMissing(data: Uint8Array, channels: number, nodes: number, nodata: GridSource["nodata"], fail: Fail): Uint8Array {
  const missing = new Uint8Array(nodes);
  const alpha = channelIndex("a", channels);
  if (alpha >= 0) for (let i = 0; i < nodes; i++) if (data[i * channels + alpha] === 0) missing[i] = 1;
  if (nodata && typeof nodata === "object") {
    const channel = channelIndex(nodata.channel, channels);
    if (channel < 0) fail({ code: "encoding", image: { channels }, detail: `nodata: channel: ${nodata.channel}` });
    const { below, above, equals } = nodata;
    for (let i = 0; i < nodes; i++) {
      const byte = data[i * channels + channel]!;
      if ((below !== undefined && byte < below) || (above !== undefined && byte > above) || (equals !== undefined && byte === equals)) {
        missing[i] = 1;
      }
    }
  }
  return missing;
}

/** `rg-uv` and `scalar-r`: an 8-bit PNG. */
function decodeImage(bytes: Uint8Array, spec: GridSource, host: GridHost, fail: Fail): Decoded {
  const header = readPngHeader(bytes);
  if (header === "not-png") fail({ code: "not-format", expected: "PNG" });
  checkCells(header.width * header.height, host, fail);
  const components = spec.encoding === "rg-uv" ? 2 : 1;
  let image: ReturnType<typeof decodePng>;
  try {
    image = decodePng(bytes);
  } catch (error) {
    if (error instanceof PngError && error.reason === "unsupported") {
      return fail({ code: "encoding", encoding: spec.encoding, image: error.image });
    }
    if (error instanceof PngError && error.reason === "not-png") return fail({ code: "not-format", expected: "PNG" });
    return fail({ code: "read", detail: String((error as Error).message ?? error) });
  }
  // `rg-uv` reads red and green: an RGB or RGBA image. A gray+alpha image's
  // second channel is alpha, never v.
  if (components === 2 && image.channels < 3) {
    fail({ code: "encoding", encoding: spec.encoding, image: { channels: image.channels } });
  }
  const geometry = imageGeometry(spec, image.width, image.height, fail);
  return {
    geometry,
    components,
    missing: imageMissing(image.data, image.channels, image.width * image.height, spec.nodata, fail),
    bytes: { data: image.data, channels: image.channels },
  };
}

/** One nullschool record's header, as far as the grid reads it. */
interface NullschoolHeader {
  lo1: number;
  la1: number;
  dx: number;
  dy: number;
  nx: number;
  ny: number;
  parameterNumber?: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The header of record `n`, or a `read` failure naming what it lacks. */
function nullschoolHeader(record: unknown, n: number, fail: Fail): NullschoolHeader {
  const header = isObject(record) ? record["header"] : undefined;
  const keys = ["lo1", "la1", "dx", "dy", "nx", "ny"] as const;
  if (!isObject(header) || !keys.every((k) => finite(header[k]))) {
    return fail({ code: "read", detail: `record ${n} has no header with lo1, la1, dx, dy, nx and ny` });
  }
  const h = header as Record<(typeof keys)[number], number> & { la2?: unknown; parameterNumber?: unknown };
  if (!(Number.isInteger(h.nx) && h.nx > 0 && Number.isInteger(h.ny) && h.ny > 0 && h.dx > 0 && h.dy !== 0)) {
    return fail({ code: "read", detail: `record ${n}'s header has nx ${h.nx}, ny ${h.ny}, dx ${h.dx}, dy ${h.dy}; counts must be positive whole numbers and spacings non-zero` });
  }
  // The rows are read from la1 southward. A header whose la2 lies north of
  // la1 scanned the other way; reading it as-is would turn the field upside down.
  if (finite(h.la2) && h.la2 > h.la1) {
    return fail({ code: "read", detail: `record ${n}'s rows run south to north (la1 ${h.la1}, la2 ${h.la2}); a grid's first row must be its northern edge` });
  }
  return {
    lo1: h.lo1,
    la1: h.la1,
    dx: h.dx,
    // The header counts rows southward from la1 (the grib2json convention); a negative dy says the same.
    dy: Math.abs(h.dy),
    nx: h.nx,
    ny: h.ny,
    ...(finite(h.parameterNumber) ? { parameterNumber: h.parameterNumber } : {}),
  };
}

/** `nullschool-json`: one record (scalar) or two (u, v), physical values, geometry in the header. */
function decodeNullschool(bytes: Uint8Array, host: GridHost, fail: Fail): Decoded {
  const text = new TextDecoder().decode(bytes);
  // The counts from the header's text, before the data arrays are parsed.
  const nx = /"nx"\s*:\s*(\d+)/.exec(text);
  const ny = /"ny"\s*:\s*(\d+)/.exec(text);
  if (nx && ny) checkCells(Number(nx[1]) * Number(ny[1]), host, fail);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail({ code: "not-format", expected: "JSON" });
  }
  const records = Array.isArray(parsed) ? parsed : isObject(parsed) && "header" in parsed ? [parsed] : [];
  if (records.length < 1 || records.length > 2) {
    return fail({
      code: "read",
      detail: `the file has ${records.length} records; a grid is one record (a scalar field) or two (the u and v components)`,
    });
  }
  const headers = records.map((record, n) => nullschoolHeader(record, n + 1, fail));
  const first = headers[0]!;
  for (const h of headers.slice(1)) {
    if (h.nx !== first.nx || h.ny !== first.ny || h.lo1 !== first.lo1 || h.la1 !== first.la1 || h.dx !== first.dx || h.dy !== first.dy) {
      fail({ code: "read", detail: "the two records describe different grids; u and v must share one" });
    }
  }
  const nodes = first.nx * first.ny;
  checkCells(nodes, host, fail);
  // Two records: u then v — by parameterNumber (GRIB2's 2 and 3) when both say, else in file order.
  let order = records.map((_, i) => i);
  if (headers.length === 2 && headers.every((h) => h.parameterNumber !== undefined)) {
    order = [...order].sort((a, b) => headers[a]!.parameterNumber! - headers[b]!.parameterNumber!);
  }
  const missing = new Uint8Array(nodes);
  const floats = order.map((index) => {
    const data = (records[index] as Record<string, unknown>)["data"];
    if (!Array.isArray(data) || data.length !== nodes) {
      return fail({
        code: "read",
        detail: `record ${index + 1} has ${Array.isArray(data) ? data.length : "no"} values; its header's nx × ny needs ${nodes} values`,
      });
    }
    const out = new Float32Array(nodes);
    for (let i = 0; i < nodes; i++) {
      const v = data[i];
      if (finite(v)) out[i] = v;
      else {
        out[i] = NaN;
        missing[i] = 1;
      }
    }
    return out;
  });
  return { geometry: first, components: floats.length === 2 ? 2 : 1, missing, floats };
}

/** `geotiff`: one or two bands of a whole GeoTIFF in EPSG:4326, through the COG chunk's reader. */
async function decodeGeoTiff(bytes: Uint8Array, buffer: ArrayBuffer, spec: GridSource, host: GridHost, fail: Fail): Promise<Decoded> {
  const cog = await host.getDecoder("cog");
  // The size tags and GeoKeys from the header alone, before the bands are read.
  const header = cog.readCogHeader(bytes);
  if (header === "not-tiff") fail({ code: "not-format", expected: "GeoTIFF" });
  if (header === "truncated") fail({ code: "read", detail: "the file ends before its image directory" });
  checkCells(header.width * header.height, host, fail);
  // The header reader labels a geographic model with no GeographicTypeGeoKey "longitude/latitude": the cells are placed the same way.
  if (header.crs !== "EPSG:4326" && header.crs !== "longitude/latitude") fail({ code: "crs", ...(header.crs ? { crs: header.crs } : {}) });
  let read: Awaited<ReturnType<typeof cog.readBands>>;
  try {
    read = await cog.readBands(buffer, spec.bands);
  } catch (error) {
    return fail({ code: "read", detail: String((error as Error).message ?? error) });
  }
  if (!read.bounds) fail({ code: "read", detail: "the file has no georeferencing (no tie point and pixel scale, or transformation)" });
  const nodes = read.width * read.height;
  const nodata = typeof spec.nodata === "number" ? spec.nodata : undefined;
  const missing = new Uint8Array(nodes);
  for (const band of read.bands) {
    for (let i = 0; i < nodes; i++) {
      const v = band[i]!;
      if (!Number.isFinite(v) || v === nodata || v === read.nodata) {
        missing[i] = 1;
        band[i] = NaN;
      }
    }
  }
  return {
    geometry: boundsGeometry(read.bounds, read.width, read.height),
    components: read.bands.length === 2 ? 2 : 1,
    missing,
    floats: read.bands,
  };
}

/**
 * Decode a grid file into a field ready to sample.
 *
 * @param bytes - The whole file (already under the whole-file byte cap).
 * @param spec - The source as the document declares it (validated by the parser).
 * @param host - What the chunk uses from core (renderer/grid-host).
 * @throws {FormatError} (through `host.formatError`, format `grid`): `not-format`
 *   for bytes of another kind, `encoding` for a PNG shape this reader doesn't
 *   decode or with too few channels, `dimensions` for a `grid:` that doesn't
 *   match the image, `too-large` over the cell cap, `crs` for a GeoTIFF not in
 *   EPSG:4326, `read` for anything else; `chunk` when the COG chunk a GeoTIFF
 *   needs couldn't be downloaded.
 */
export async function decodeGrid(bytes: ArrayBuffer | ArrayBufferView, spec: GridSource, host: GridHost): Promise<GridField> {
  const u8 = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail: Fail = (failure) => {
    throw host.formatError({ format: "grid", url: spec.url, ...failure } as FormatFailure);
  };
  let decoded: Decoded;
  switch (spec.encoding) {
    case "rg-uv":
    case "scalar-r":
      decoded = decodeImage(u8, spec, host, fail);
      break;
    case "nullschool-json":
      decoded = decodeNullschool(u8, host, fail);
      break;
    case "geotiff": {
      const buffer =
        bytes instanceof ArrayBuffer ? bytes : (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? u8.buffer : u8.slice().buffer) as ArrayBuffer;
      decoded = await decodeGeoTiff(u8, buffer, spec, host, fail);
      break;
    }
    default:
      return fail({ code: "unsupported", detail: `encoding: ${String((spec as { encoding: unknown }).encoding)}` });
  }
  const range = decoded.bytes ? (spec.range ?? [0, 255]) : undefined;
  return makeField(decoded, spec.units, range);
}

// ---------------------------------------------------------------------------
// Loading: fetch, cache, decode — the source manager's body (renderer/grid-sources is its shell)
// ---------------------------------------------------------------------------

/**
 * The keys that decide what a file decodes to, beside its URL. `range` and
 * `units` are not among them: they refit a decoded field ({@link refitGrid}).
 * The source manager's fetch keys (renderer/grid-sources) are these plus `url`.
 */
export const GRID_DECODE_KEYS = ["encoding", "bounds", "grid", "nodata", "bands"] as const;

/** How many decoded fields the page keeps: a 1° global frame is 1 MB of bytes; sixteen is a day of forecast hours. */
const CACHE_ENTRIES = 16;

/**
 * The decoded bytes the cache retains over all its entries — each field's
 * channel bytes or Float32 components plus its missing mask — past which the
 * least recently used fields are dropped, whatever their count: the
 * counterpart of the cloud readers' decoded-bytes cap. Sixteen 1° RGBA
 * frames are 5 MB; sixteen quarter-degree two-component GeoTIFFs 150 MB.
 * (`values()` materializations are not counted: they are retained with the
 * field that built them, for as long as page code holds it.)
 */
export const GRID_CACHE_MAX_BYTES = 256 * 1024 * 1024;

interface CacheEntry {
  field: Promise<GridField>;
  expires: number;
  /** The bytes the field retains, once it has resolved (0 while it loads). */
  bytes: number;
}

/**
 * Decoded fields by the file and decode keys they came from, most recently
 * used last. Module level, so it outlives a renderer rebuilt for a
 * `mapStyle` change, and a second source over the same file — or the same
 * frame asked for again — costs no network.
 */
const cache = new Map<string, CacheEntry>();
/** The sum of the entries' `bytes`. */
let cacheBytes = 0;
let cacheLimits = { entries: CACHE_ENTRIES, bytes: GRID_CACHE_MAX_BYTES };

/** `value` as JSON with every object's keys in sorted order, so two spellings of one `grid:` or `nodata:` compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]])) : v
  );
}

function cacheKey(url: string, spec: GridSource): string {
  return `${url}\0${GRID_DECODE_KEYS.map((key) => canonical(spec[key])).join("\0")}`;
}

/** The bytes a field retains: its channel bytes or Float32 components, plus the missing mask. */
function retainedBytes(field: GridField): number {
  const d = DECODED.get(field);
  if (!d) return 0;
  return d.missing.byteLength + (d.bytes ? d.bytes.data.byteLength : d.floats!.reduce((n, f) => n + f.byteLength, 0));
}

function dropCached(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  cache.delete(key);
  cacheBytes -= entry.bytes;
}

/** Drop the least recently used entries while the cache is over either budget. */
function evictCached(): void {
  for (const key of cache.keys()) {
    if (cache.size <= cacheLimits.entries && cacheBytes <= cacheLimits.bytes) break;
    dropCached(key);
  }
}

/**
 * Drop every cached field.
 *
 * @internal Tests.
 */
export function clearGridCache(): void {
  cache.clear();
  cacheBytes = 0;
}

/**
 * Lower the cache's budgets; with no argument, restore the defaults
 * ({@link GRID_CACHE_MAX_BYTES} and sixteen entries).
 *
 * @internal Tests.
 */
export function setGridCacheLimits(limits: Partial<{ entries: number; bytes: number }> = {}): void {
  cacheLimits = { entries: limits.entries ?? CACHE_ENTRIES, bytes: limits.bytes ?? GRID_CACHE_MAX_BYTES };
}

/**
 * `field` as `spec` declares it: itself when its `range:` and `units:`
 * already match, else a new field over the same retained bytes (no decode,
 * no fetch). The field given is never changed.
 */
export function refitGrid(field: GridField, spec: GridSource): GridField {
  const d = DECODED.get(field);
  if (!d) return field;
  const range = d.bytes ? (spec.range ?? [0, 255]) : undefined;
  const sameRange = range && field.range ? range[0] === field.range[0] && range[1] === field.range[1] : range === field.range;
  if (sameRange && field.units === spec.units) return field;
  return makeField(d, spec.units, range);
}

/** Download `url` whole under the byte cap (abandoned when `signal` aborts), then decode it for `spec`. */
async function fetchAndDecode(url: string, spec: GridSource, host: GridLoadHost, signal: AbortSignal | undefined): Promise<GridField> {
  const fail: Fail = (failure) => {
    throw host.formatError({ format: "grid", url: spec.url, ...failure } as FormatFailure);
  };
  const bytes = await host.fetchWhole(url, { maxWholeBytes: host.limits?.bytes, signal }).then(
    (whole) => whole.bytes,
    (error: unknown) => {
      const e = error as { name?: unknown; size?: unknown; status?: unknown; message?: unknown };
      // Abandoned on purpose: not a failure to word.
      if (e.name === "AbortError") throw error;
      if (e.name === "BodyTooLarge") fail({ code: "too-large", size: Number(e.size), sizeIsFile: true, limits: { bytes: host.limits?.bytes } });
      if (typeof e.status === "number") fail({ code: "http", status: e.status });
      return fail({ code: "cors", detail: String(e.message ?? error) });
    }
  );
  return decodeGrid(bytes, spec, host);
}

/**
 * The field for `spec`: fetched whole (under the byte cap), decoded, and
 * kept for the next request of the same file and decode keys (`cache:` on
 * the source is honoured as on other sources: `enabled: false` bypasses it,
 * `ttl` expires it). A cached field with another `range:` or `units:` is
 * refit rather than fetched again.
 *
 * @param signal - Aborts the download when the load bypasses the cache
 *   (`cache: { enabled: false }`). A cached load is shared with other sources
 *   and later requests of the same file, so it is never aborted: the signal
 *   is ignored.
 * @throws {FormatError} (format `grid`): `http` for an error status, `cors`
 *   when the request never completed, `too-large` over the byte cap (before
 *   anything is decoded), and whatever {@link decodeGrid} raises. An aborted
 *   download rejects with the `AbortError` itself.
 */
export function loadGrid(spec: GridSource, host: GridLoadHost, signal?: AbortSignal): Promise<GridField> {
  const safe = host.safeUrl(spec.url);
  if (safe === null) {
    return Promise.reject(host.formatError({ format: "grid", url: spec.url, code: "read", detail: "a page can't fetch a URL with this scheme" }));
  }
  const url = host.absoluteUrl(safe);
  const cached = spec.cache?.enabled !== false;
  const key = cacheKey(url, spec);
  const now = Date.now();
  const hit = cached ? cache.get(key) : undefined;
  if (hit && hit.expires > now) {
    cache.delete(key);
    cache.set(key, hit);
    return hit.field.then((field) => refitGrid(field, spec));
  }
  const field = fetchAndDecode(url, spec, host, cached ? undefined : signal);
  if (cached) {
    const entry: CacheEntry = { field, expires: spec.cache?.ttl ? now + spec.cache.ttl : Infinity, bytes: 0 };
    // An expired entry under this key goes, with its place in the order.
    dropCached(key);
    cache.set(key, entry);
    field.then(
      (resolved) => {
        if (cache.get(key) !== entry) return;
        entry.bytes = retainedBytes(resolved);
        cacheBytes += entry.bytes;
        evictCached();
      },
      // A failure is not kept: the next request (a `reload()`) asks again.
      () => {
        if (cache.get(key) === entry) dropCached(key);
      }
    );
    evictCached();
  }
  return field;
}
