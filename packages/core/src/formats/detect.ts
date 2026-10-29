/**
 * @file Which cloud-native file format a source reads (0.9, ml-cnv)
 * @module @maplibre-yaml/core/formats/detect
 *
 * @description
 * The authoring rule (design D1, maintainer decision 2026-10-20):
 *
 * > `type:` says what MapLibre draws (`vector`, `raster`, `raster-dem`,
 * > `geojson`). The URL says what the file is.
 *
 * The format comes from the URL's scheme (`pmtiles://`, `cog://`) or its
 * extension (`.pmtiles`, `.fgb`, `.parquet`/`.geoparquet`, `.tif`/`.tiff`),
 * read from the path only (query and fragment dropped). An optional
 * `format:` key names it outright when the URL has no telling extension
 * (a signed URL, an API endpoint); `format:` wins over the URL.
 *
 * Four formats are recognized, and all four are read in this version:
 *
 * | Format | Source `type:` | Read in 0.9 |
 * | --- | --- | --- |
 * | PMTiles | `vector`, `raster`, `raster-dem` | yes (tile protocol) |
 * | FlatGeobuf | `geojson` | yes (decoded to GeoJSON) |
 * | GeoParquet | `geojson` | yes (decoded to GeoJSON) |
 * | COG | `raster`, `raster-dem` | yes (tile protocol, reader on demand) |
 *
 * Everything here is pure (no DOM, no maplibre-gl), so the parser, the
 * renderer, the emitter and `mlym validate` share one answer.
 */

/** Every file format the authoring syntax recognizes. */
export const CLOUD_FORMATS = ["pmtiles", "flatgeobuf", "geoparquet", "cog"] as const;

/** A recognized cloud-native file format. */
export type CloudFormat = (typeof CLOUD_FORMATS)[number];

/**
 * Formats this version reads YAML-only: all four in 0.9. A format added to
 * CLOUD_FORMATS ahead of its reader is reported as "can't read" instead.
 */
export const SUPPORTED_FORMATS: ReadonlySet<CloudFormat> = new Set<CloudFormat>([
  "pmtiles",
  "flatgeobuf",
  "geoparquet",
  "cog",
]);

/** What a format holds, and the source types that can draw it. */
export interface FormatInfo {
  /** The name people know it by, for messages. */
  label: string;
  /** Tiles (a tile protocol) or features (decoded into a GeoJSON source). */
  holds: "tiles" | "features";
  /** The MapLibre source types that can read it. */
  types: readonly string[];
}

export const FORMAT_INFO: Readonly<Record<CloudFormat, FormatInfo>> = {
  pmtiles: { label: "PMTiles", holds: "tiles", types: ["vector", "raster", "raster-dem"] },
  cog: { label: "Cloud Optimized GeoTIFF (COG)", holds: "tiles", types: ["raster", "raster-dem"] },
  flatgeobuf: { label: "FlatGeobuf", holds: "features", types: ["geojson"] },
  geoparquet: { label: "GeoParquet", holds: "features", types: ["geojson"] },
};

/** URL schemes that name a tile protocol. */
const SCHEMES: ReadonlyArray<[string, CloudFormat]> = [
  ["pmtiles://", "pmtiles"],
  ["cog://", "cog"],
];

/** File extensions, matched on the URL path (query and fragment dropped). */
const EXTENSIONS: ReadonlyArray<[RegExp, CloudFormat]> = [
  [/\.pmtiles$/i, "pmtiles"],
  [/\.fgb$/i, "flatgeobuf"],
  [/\.(?:geo)?parquet$/i, "geoparquet"],
  [/\.tiff?$/i, "cog"],
];

/** Whether `value` is one of the recognized format names. */
export function isCloudFormat(value: unknown): value is CloudFormat {
  return typeof value === "string" && (CLOUD_FORMATS as readonly string[]).includes(value);
}

/** The protocol scheme a URL starts with (`pmtiles`, `cog`), if any. */
export function schemeFormat(url: string): CloudFormat | undefined {
  const lower = url.slice(0, 12).toLowerCase();
  for (const [scheme, format] of SCHEMES) if (lower.startsWith(scheme)) return format;
  return undefined;
}

/** The URL with a recognized protocol scheme removed (`pmtiles://x` → `x`). */
export function stripScheme(url: string): string {
  const format = schemeFormat(url);
  if (!format) return url;
  return url.slice(url.indexOf("://") + 3);
}

/** The path part of a URL, for extension sniffing (query and fragment dropped). */
function pathOf(url: string): string {
  return url.replace(/[?#].*$/, "");
}

/**
 * The format a URL names by its scheme or extension.
 *
 * @example
 * ```ts
 * formatFromUrl("pmtiles://https://x.org/a.pmtiles"); // "pmtiles"
 * formatFromUrl("data/parcels.fgb?v=2");               // "flatgeobuf"
 * formatFromUrl("https://x.org/tiles.json");           // undefined
 * ```
 */
export function formatFromUrl(url: unknown): CloudFormat | undefined {
  if (typeof url !== "string" || url === "") return undefined;
  const scheme = schemeFormat(url);
  if (scheme) return scheme;
  const path = pathOf(url);
  for (const [pattern, format] of EXTENSIONS) if (pattern.test(path)) return format;
  return undefined;
}

type Obj = Record<string, unknown>;

const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The `format:` an author declared on a source: flat (v1, and every source
 * the renderer sees after denormalization) or under a v2 source's `runtime:`.
 */
export function declaredFormat(source: unknown): unknown {
  if (!isObject(source)) return undefined;
  if (source["format"] !== undefined) return source["format"];
  const runtime = source["runtime"];
  return isObject(runtime) ? runtime["format"] : undefined;
}

/**
 * The cloud-native format a source reads, or `undefined` for an ordinary
 * source (a TileJSON URL, a GeoJSON file, inline data, a `tiles:` list).
 *
 * @remarks
 * A valid `format:` wins (the URL may be extensionless or a redirect);
 * otherwise the URL's scheme or extension decides. The source `type` is
 * NOT consulted: a `.pmtiles` URL on a `geojson` source is still PMTiles —
 * {@link formatTypeMismatch} reports that as the author's mistake rather
 * than this function hiding it.
 */
export function formatOfSource(source: unknown): CloudFormat | undefined {
  if (!isObject(source)) return undefined;
  const declared = declaredFormat(source);
  if (isCloudFormat(declared)) return declared;
  return formatFromUrl(source["url"]);
}

/** `load: viewport` reads nothing below this zoom unless `minzoom` says otherwise. */
export const VIEWPORT_DEFAULT_MINZOOM = 10;

/**
 * The most features one by-view read takes unless `maxFeatures` says
 * otherwise (ml-37r.17). A view estimated to hold more is not read: the map
 * asks the reader to zoom in instead.
 *
 * @remarks
 * Measured on NYC PLUTO parcels as polygons (PR #205's benchmark, Chromium
 * on a desktop with a GPU and two laptop profiles, 2026-10-23):
 * the largest by-view read that stayed usable was a borough view of about
 * 94,000 lots (FlatGeobuf 36 MB, GeoParquet 20 MB; 5–6 s to draw on the
 * desktop, 15–21 s on the laptops, 2.5–3.8 GB of renderer memory, 12–54 fps
 * while panning); the citywide view (about 775,000 lots in view) took 30 s,
 * 5.3 GB and ran at 8 fps (FlatGeobuf) or crashed the tab (GeoParquet).
 * 150,000 leaves headroom over the borough view for a larger screen and stays
 * a fifth of the view that failed.
 */
export const VIEWPORT_DEFAULT_MAX_FEATURES = 150_000;

/** How a FlatGeobuf or GeoParquet source is read (`load:`). */
export interface LoadMode {
  mode: "all" | "viewport";
  /** Viewport mode reads nothing below this zoom. */
  minzoom: number;
  /** The most features one by-view read takes (`load: { maxFeatures }`). */
  maxFeatures: number;
  /**
   * The author's own `maxFeatures`, when the document sets one: it also
   * raises the whole-file feature limit (never lowers it), so one key lets a
   * file over the limit load whole and a dense view read.
   */
  authorMaxFeatures?: number;
  /**
   * The author's own `minzoom`, when the document sets one: it always wins
   * over the overview files' floor of 0 (0.10, ml-cnv.22).
   */
  authorMinzoom?: number;
  /**
   * Whether a GeoParquet overview file read by view draws the `geo:overviews`
   * level that fits the zoom (`load: { overviews }`, default true); false
   * reads its canonical level only, as 0.9.2 does.
   */
  overviews: boolean;
}

/**
 * The source's `load:` key, normalized (`all` when absent or unrecognized):
 * flat (v1, and every source the renderer sees) or under a v2 source's
 * `runtime:`; the bare string or the `{ mode, minzoom, maxFeatures, overviews }`
 * object (`mode` defaults to `all`, `overviews` to true).
 */
export function loadModeOf(source: unknown): LoadMode {
  const runtime = isObject(source) ? source["runtime"] : undefined;
  const load = isObject(source) ? (source["load"] ?? (isObject(runtime) ? runtime["load"] : undefined)) : undefined;
  const num = (key: string): number | undefined =>
    isObject(load) && typeof load[key] === "number" ? (load[key] as number) : undefined;
  const viewport =
    (typeof load === "string" && load.trim().toLowerCase() === "viewport") ||
    (isObject(load) && load["mode"] === "viewport");
  const author = num("maxFeatures");
  const minzoom = num("minzoom");
  return {
    mode: viewport ? "viewport" : "all",
    minzoom: minzoom ?? VIEWPORT_DEFAULT_MINZOOM,
    // Also read for `all`: a file too large to load whole is read by view.
    maxFeatures: author ?? VIEWPORT_DEFAULT_MAX_FEATURES,
    overviews: !isObject(load) || load["overviews"] !== false,
    ...(author !== undefined ? { authorMaxFeatures: author } : {}),
    ...(minzoom !== undefined ? { authorMinzoom: minzoom } : {}),
  };
}

/**
 * A GeoParquet source's `columns:` (flat, or under a v2 source's
 * `runtime:`): the attribute columns to read — a list, or `all` — or
 * `undefined` when the author left the choice to the document's references.
 */
export function declaredColumns(source: unknown): readonly string[] | "all" | undefined {
  if (!isObject(source)) return undefined;
  const runtime = source["runtime"];
  const columns = source["columns"] ?? (isObject(runtime) ? runtime["columns"] : undefined);
  if (typeof columns === "string" && columns.trim().toLowerCase() === "all") return "all";
  if (Array.isArray(columns)) return columns.filter((c): c is string => typeof c === "string");
  return undefined;
}

/**
 * Whether a source type can read a format (`vector` + PMTiles: yes,
 * `geojson` + PMTiles: no). Unknown types are not judged.
 */
export function typeReadsFormat(type: unknown, format: CloudFormat): boolean {
  if (typeof type !== "string") return true;
  return FORMAT_INFO[format].types.includes(type);
}

/** Visit every source object of a document — named, and inline on a layer. */
function eachSource(
  sources: unknown,
  layers: unknown,
  visit: (source: Obj) => void
): void {
  if (isObject(sources)) for (const s of Object.values(sources)) if (isObject(s)) visit(s);
  if (Array.isArray(layers)) {
    for (const layer of layers) {
      const s = isObject(layer) ? layer["source"] : undefined;
      if (isObject(s)) visit(s);
    }
  }
}

/**
 * The supported formats a document's sources read, compatible with their
 * type — what the renderer must have ready before it adds those sources.
 */
export function formatsIn(sources: unknown, layers: unknown): Set<CloudFormat> {
  const found = new Set<CloudFormat>();
  eachSource(sources, layers, (source) => {
    const format = formatOfSource(source);
    if (format && SUPPORTED_FORMATS.has(format) && typeReadsFormat(source["type"], format)) {
      found.add(format);
    }
  });
  return found;
}

/**
 * Words authors write as a source `type:` that are really file formats,
 * mapped to the format (or `mbtiles`, which no browser can read).
 */
const FORMAT_TYPE_WORDS: Readonly<Record<string, CloudFormat | "mbtiles">> = {
  pmtiles: "pmtiles",
  flatgeobuf: "flatgeobuf",
  fgb: "flatgeobuf",
  geoparquet: "geoparquet",
  parquet: "geoparquet",
  cog: "cog",
  geotiff: "cog",
  tiff: "cog",
  tif: "cog",
  mbtiles: "mbtiles",
};

/**
 * The format a mistaken `type:` value names (`type: pmtiles` → `pmtiles`),
 * case-insensitively, or `undefined` for anything else.
 */
export function formatNamedAsType(type: unknown): CloudFormat | "mbtiles" | undefined {
  if (typeof type !== "string") return undefined;
  return FORMAT_TYPE_WORDS[type.trim().toLowerCase()];
}
