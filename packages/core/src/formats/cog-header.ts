/**
 * @file What a GeoTIFF's first bytes say about it (0.9, ml-cnv.2)
 * @module @maplibre-yaml/core/formats/cog-header
 *
 * @description
 * A Cloud Optimized GeoTIFF keeps everything a reader needs to plan its
 * reads — the image size, the tile layout, the overviews and the coordinate
 * system — in its first few kilobytes. Core reads those bytes once per file,
 * before the COG plugin draws anything, for the two mistakes the plugin
 * would otherwise make silently:
 *
 * - **Not Web Mercator.** The plugin only draws EPSG:3857; a GeoTIFF in
 *   longitude/latitude (EPSG:4326) or a national grid draws as a blank or
 *   misplaced rectangle with no error at all.
 * - **Not cloud-optimized.** An ordinary GeoTIFF (in strips, or without
 *   overviews) still draws, but the browser may download most of the file
 *   to draw it.
 *
 * A small hand-written reader of the TIFF/BigTIFF header and the GeoKey
 * directory, with no dependencies: it runs before the plugin is even
 * downloaded, and in Node for the unit tests.
 */

/** What {@link readCogHeader} found. */
export interface CogHeader {
  /** Full-resolution image size, in pixels. */
  width: number;
  height: number;
  /** Internal tile size, when the image is tiled (absent: stored in strips). */
  tileWidth?: number;
  tileHeight?: number;
  /** Whether more images follow the first (overviews, or a mask). */
  hasOverviews: boolean;
  /**
   * The coordinate system, as `EPSG:<code>`, when the GeoKeys name one;
   * `"user-defined"` when they describe one by parameters; absent when the
   * file has no GeoKeys at all (a plain TIFF, not a GeoTIFF).
   */
  crs?: string;
  /** Whether {@link crs} is Web Mercator (or can't be judged: user-defined). */
  webMercator: boolean;
  /**
   * The image's extent in longitude/latitude, `[west, south, east, north]`,
   * from its georeferencing (tie point and pixel scale, or a transformation
   * matrix) — for a Web Mercator file. What `fitTo` frames before the reader
   * has drawn anything.
   */
  bounds?: [number, number, number, number];
}

/** Why bytes could not be read as a TIFF header. */
export type CogHeaderProblem = "not-tiff" | "truncated";

/** Some bytes of a file, and where in the file they start. */
export interface FilePart {
  start: number;
  bytes: Uint8Array;
}

/** The bytes a header read still needs: `length` bytes from `offset`. */
export interface MissingBytes {
  missing: { offset: number; length: number };
}

/** EPSG codes (and the ESRI/legacy aliases) that mean Web Mercator. */
const WEB_MERCATOR = new Set([3857, 900913, 3785, 102100, 102113]);

/** User-defined, in the GeoTIFF spec. */
const USER_DEFINED = 32767;

const TAG = {
  ImageWidth: 256,
  ImageLength: 257,
  TileWidth: 322,
  TileLength: 323,
  GeoKeyDirectory: 34735,
  ModelPixelScale: 33550,
  ModelTiepoint: 33922,
  ModelTransformation: 34264,
} as const;

/** Web Mercator's sphere radius, in metres. */
const EARTH_RADIUS = 6378137;

/** A Web Mercator `[x, y]` in metres as `[longitude, latitude]`. */
function mercatorToLonLat(x: number, y: number): [number, number] {
  const lon = (x / EARTH_RADIUS) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI);
  return [Math.max(-180, Math.min(180, lon)), Math.max(-85.051129, Math.min(85.051129, lat))];
}

const GEOKEY = {
  ModelType: 1024,
  GeographicType: 2048,
  ProjectedCSType: 3072,
} as const;

/** Bytes per value, by TIFF field type. */
const TYPE_SIZE: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8,
};

/** Whether the bytes start like a TIFF or BigTIFF file. */
export function isTiff(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const le = bytes[0] === 0x49 && bytes[1] === 0x49;
  const be = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!le && !be) return false;
  const version = le ? bytes[2]! | (bytes[3]! << 8) : (bytes[2]! << 8) | bytes[3]!;
  return version === 42 || version === 43;
}

class Truncated extends Error {
  constructor(
    readonly offset: number,
    readonly length: number
  ) {
    super(`needs ${length} bytes at ${offset}`);
  }
}

/**
 * Read the header of a (Big)TIFF from its first bytes.
 *
 * @param bytes - The start of the file (64 KB covers any COG's header).
 * @returns The header, or the problem: `not-tiff` for bytes that aren't a
 *   TIFF at all (a web page served under a `.tif` name), `truncated` when
 *   the header reaches past the bytes given (an unusually laid-out file:
 *   {@link readCogHeaderParts} says which bytes it needs).
 */
export function readCogHeader(bytes: Uint8Array): CogHeader | CogHeaderProblem {
  const read = readCogHeaderParts([{ start: 0, bytes }]);
  return typeof read === "object" && "missing" in read ? "truncated" : read;
}

/**
 * Read the header of a (Big)TIFF from parts of the file: its start, plus
 * whatever else has been read. An ordinary GeoTIFF written "IFD last" (by
 * writers other than GDAL's COG driver) keeps its directory and GeoKeys at
 * the end of the file, past the first read.
 *
 * @param parts - The file's start (`start: 0`) and any other parts read.
 * @returns The header; `not-tiff`; or the bytes still needed — the caller
 *   reads them and asks again.
 */
export function readCogHeaderParts(parts: readonly FilePart[]): CogHeader | "not-tiff" | MissingBytes {
  const head = parts.find((p) => p.start === 0);
  if (!head || !isTiff(head.bytes)) return "not-tiff";
  try {
    return parse(parts, head.bytes);
  } catch (error) {
    if (error instanceof Truncated) return { missing: { offset: error.offset, length: error.length } };
    if (error instanceof RangeError) return { missing: { offset: head.bytes.length, length: 1 } };
    throw error;
  }
}

function parse(parts: readonly FilePart[], head: Uint8Array): CogHeader {
  const views = parts.map((p) => ({
    start: p.start,
    end: p.start + p.bytes.length,
    view: new DataView(p.bytes.buffer, p.bytes.byteOffset, p.bytes.byteLength),
  }));
  const le = head[0] === 0x49;
  const big = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint16(2, le) === 43;
  /** The view holding `length` bytes at `offset`, and where they are in it. */
  const at = (offset: number, length: number): [DataView, number] => {
    const part = views.find((v) => offset >= v.start && offset + length <= v.end);
    if (!part) throw new Truncated(offset, length);
    return [part.view, offset - part.start];
  };
  const need = (offset: number, length: number) => void at(offset, length);
  const u16 = (o: number) => {
    const [view, i] = at(o, 2);
    return view.getUint16(i, le);
  };
  const u32 = (o: number) => {
    const [view, i] = at(o, 4);
    return view.getUint32(i, le);
  };
  const u64 = (o: number) => {
    const [view, i] = at(o, 8);
    const lo = view.getUint32(i + (le ? 0 : 4), le);
    const hi = view.getUint32(i + (le ? 4 : 0), le);
    return hi * 2 ** 32 + lo;
  };
  const u8 = (o: number) => {
    const [view, i] = at(o, 1);
    return view.getUint8(i);
  };
  const f64 = (o: number) => {
    const [view, i] = at(o, 8);
    return view.getFloat64(i, le);
  };
  const offsetAt = big ? u64 : u32;

  const ifd = offsetAt(big ? 8 : 4);
  const count = big ? u64(ifd) : u16(ifd);
  const entrySize = big ? 20 : 12;
  const first = ifd + (big ? 8 : 2);
  const inlineSize = big ? 8 : 4;

  /** Every value of one entry, as numbers (integer types only). */
  const values = (entry: number): number[] => {
    const type = u16(entry + 2);
    const n = big ? u64(entry + 4) : u32(entry + 4);
    const size = TYPE_SIZE[type] ?? 1;
    const valueField = entry + (big ? 12 : 8);
    const where = n * size <= inlineSize ? valueField : offsetAt(valueField);
    need(where, n * size);
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const o = where + i * size;
      if (type === 3) out.push(u16(o));
      else if (type === 4) out.push(u32(o));
      else if (type === 16) out.push(u64(o));
      else if (type === 12) out.push(f64(o));
      else if (type === 1 || type === 7) out.push(u8(o));
      else out.push(Number.NaN);
    }
    return out;
  };

  const tags = new Map<number, number>();
  for (let i = 0; i < count; i++) tags.set(u16(first + i * entrySize), first + i * entrySize);
  const one = (tag: number) => {
    const entry = tags.get(tag);
    return entry === undefined ? undefined : values(entry)[0];
  };
  const next = offsetAt(first + count * entrySize);

  const header: CogHeader = {
    width: one(TAG.ImageWidth) ?? 0,
    height: one(TAG.ImageLength) ?? 0,
    hasOverviews: next !== 0,
    webMercator: false,
  };
  const tileWidth = one(TAG.TileWidth);
  const tileHeight = one(TAG.TileLength);
  if (tileWidth !== undefined) header.tileWidth = tileWidth;
  if (tileHeight !== undefined) header.tileHeight = tileHeight;

  const geoEntry = tags.get(TAG.GeoKeyDirectory);
  if (geoEntry !== undefined) {
    const dir = values(geoEntry);
    const keys = new Map<number, number>();
    // [version, revision, minor, count] then [key, location, count, value]…
    // — only the values stored inline (location 0) are codes.
    for (let i = 4; i + 3 < dir.length && keys.size < (dir[3] ?? 0); i += 4) {
      if (dir[i + 1] === 0) keys.set(dir[i]!, dir[i + 3]!);
    }
    const model = keys.get(GEOKEY.ModelType);
    const projected = keys.get(GEOKEY.ProjectedCSType);
    const geographic = keys.get(GEOKEY.GeographicType);
    if (projected !== undefined && projected !== USER_DEFINED) {
      header.crs = `EPSG:${projected}`;
      header.webMercator = WEB_MERCATOR.has(projected);
    } else if (model === 2) {
      header.crs = geographic !== undefined && geographic !== USER_DEFINED ? `EPSG:${geographic}` : "longitude/latitude";
    } else if (model === 1 || projected === USER_DEFINED) {
      // Projected by parameters: Web Mercator written out longhand is
      // possible and can't be told apart cheaply; let it through.
      header.crs = "user-defined";
      header.webMercator = true;
    } else if (keys.size > 0) {
      header.crs = "user-defined";
      header.webMercator = true;
    }
  }
  if (header.webMercator && header.width > 0 && header.height > 0) {
    const extent = mercatorExtent(header.width, header.height, tags, values);
    if (extent) {
      const [w, s] = mercatorToLonLat(extent[0], extent[1]);
      const [e, n] = mercatorToLonLat(extent[2], extent[3]);
      if (w < e && s < n) header.bounds = [w, s, e, n];
    }
  }
  return header;
}

/**
 * The image's extent in its own (Web Mercator) units, from the tie point and
 * pixel scale, or from a transformation matrix without rotation.
 */
function mercatorExtent(
  width: number,
  height: number,
  tags: Map<number, number>,
  values: (entry: number) => number[]
): [number, number, number, number] | undefined {
  const read = (tag: number) => {
    const entry = tags.get(tag);
    return entry === undefined ? undefined : values(entry);
  };
  let x0: number | undefined;
  let y0: number | undefined;
  let sx: number | undefined;
  let sy: number | undefined;
  const scale = read(TAG.ModelPixelScale);
  const tie = read(TAG.ModelTiepoint);
  if (scale && tie && scale.length >= 2 && tie.length >= 6) {
    // Raster point (i, j) is model point (x, y); y grows northward.
    sx = scale[0]!;
    sy = scale[1]!;
    x0 = tie[3]! - tie[0]! * sx;
    y0 = tie[4]! + tie[1]! * sy;
  } else {
    const m = read(TAG.ModelTransformation);
    if (m && m.length >= 16 && m[1] === 0 && m[4] === 0) {
      sx = m[0]!;
      sy = -m[5]!;
      x0 = m[3]!;
      y0 = m[7]!;
    }
  }
  if (![x0, y0, sx, sy].every((v) => typeof v === "number" && Number.isFinite(v)) || !(sx! > 0) || !(sy! > 0)) {
    return undefined;
  }
  return [x0!, y0! - height * sy!, x0! + width * sx!, y0!];
}

/**
 * Whether a header describes a file the browser can read efficiently: in
 * tiles, with overviews once the image is bigger than a couple of tiles.
 * Small images pass either way — there is little to download.
 */
export function isCloudOptimized(header: CogHeader): boolean {
  const largest = Math.max(header.width, header.height);
  if (header.tileWidth === undefined || header.tileHeight === undefined) return largest <= 256;
  if (header.hasOverviews) return true;
  return header.width <= 2 * header.tileWidth && header.height <= 2 * header.tileHeight;
}
