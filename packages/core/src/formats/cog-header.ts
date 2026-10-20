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
}

/** Why bytes could not be read as a TIFF header. */
export type CogHeaderProblem = "not-tiff" | "truncated";

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
} as const;

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

class Truncated extends Error {}

/**
 * Read the header of a (Big)TIFF from its first bytes.
 *
 * @param bytes - The start of the file (64 KB covers any COG's header).
 * @returns The header, or the problem: `not-tiff` for bytes that aren't a
 *   TIFF at all (a web page served under a `.tif` name), `truncated` when
 *   the header reaches past the bytes given (an unusually laid-out file:
 *   the caller lets the plugin decide).
 */
export function readCogHeader(bytes: Uint8Array): CogHeader | CogHeaderProblem {
  if (!isTiff(bytes)) return "not-tiff";
  try {
    return parse(bytes);
  } catch (error) {
    if (error instanceof Truncated || error instanceof RangeError) return "truncated";
    throw error;
  }
}

function parse(bytes: Uint8Array): CogHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const le = bytes[0] === 0x49;
  const big = view.getUint16(2, le) === 43;
  const need = (offset: number, length: number) => {
    if (offset + length > bytes.length) throw new Truncated();
  };
  const u16 = (o: number) => (need(o, 2), view.getUint16(o, le));
  const u32 = (o: number) => (need(o, 4), view.getUint32(o, le));
  const u64 = (o: number) => {
    need(o, 8);
    const lo = view.getUint32(o + (le ? 0 : 4), le);
    const hi = view.getUint32(o + (le ? 4 : 0), le);
    return hi * 2 ** 32 + lo;
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
    const at = n * size <= inlineSize ? valueField : offsetAt(valueField);
    need(at, n * size);
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const o = at + i * size;
      if (type === 3) out.push(view.getUint16(o, le));
      else if (type === 4) out.push(view.getUint32(o, le));
      else if (type === 16) out.push(u64(o));
      else if (type === 1 || type === 7) out.push(view.getUint8(o));
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
  return header;
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
