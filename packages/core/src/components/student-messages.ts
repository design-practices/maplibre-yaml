/**
 * @file On-page messages for the mistakes people make while learning
 * @module @maplibre-yaml/core/components/student-messages
 *
 * @description
 * Pure text builders behind `<ml-map>`'s error card and notice: given what
 * failed (a `src` fetch, the basemap style, one layer's data), say what
 * happened in words a beginner can act on, with the resolved URL where a
 * wrong path is the likely cause. No DOM here, so every message is unit-
 * testable without a map.
 *
 * Messages may mark names with backticks (`` `cities` ``); the notice renders
 * those as code.
 */

import type { ParseError } from "../parser/yaml-parser.js";
import { suggestColorName } from "../schemas/css-colors.js";
import { SPEC_LAYOUT_KEYS, SPEC_PAINT_KEYS } from "../parser/spec-keys.generated.js";
import { suggest } from "../utils/suggest.js";
import { normalizeDocumentBase } from "../utils/document-base.js";
import type { FormatFailure } from "../formats/errors.js";
import { DEFAULT_STRINGS, defaultStrings, type Strings } from "../i18n/strings.js";
import { formatNumber } from "../i18n/number-format.js";
import { memoryEstimateGB, roundedRaise, SAFE_WHOLE_FILE_FEATURES } from "../formats/large-data.js";

// Titles and hints a reader can meet on a map whose document WAS read (the
// basemap failed, the worker couldn't start) come from the UI string table,
// so the document's `locale:` translates them. Messages shown before a
// document is read (a `src` that didn't load) have no `locale:` to read and
// stay English, like every author diagnostic in this file.

/** What the error card shows: a title, the errors, and how to fix them. */
export interface ErrorCardContent {
  title: string;
  errors: ParseError[];
  /** One short paragraph: what to do next. */
  hint?: string;
}

/** Whether `doc` was opened straight from disk (`file://`). */
export function isFilePage(doc: Document | undefined): boolean {
  try {
    return doc?.location?.protocol === "file:";
  } catch {
    return false;
  }
}

/** The fix for a page opened from disk (English; see the string table). */
export const FILE_PAGE_HINT: string = DEFAULT_STRINGS["maplibre-yaml.ErrorCard.LocalServerHint"];

/** `url` resolved against `base` (the page), or `url` itself if it will not parse. */
export function resolveUrl(url: string, base: string | undefined): string {
  try {
    return base ? new URL(url, base).href : new URL(url).href;
  } catch {
    return url;
  }
}

/** Whether a reference resolves relative to something (no scheme, no leading `/`). */
function isRelativeReference(url: string): boolean {
  return !/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url) && !url.startsWith("/");
}

/**
 * For a root-relative path (`/data/x.geojson`) that failed on a page served
 * from a subpath (`/my-repo/…`, a GitHub Pages project site) while `<ml-map>`
 * has no `base`: the sentence suggesting one (ml-aot.30). `undefined` when
 * that is not the likely cause.
 */
export function subpathBaseHint(
  url: string,
  pageUrl: string | undefined,
  base: string | null | undefined
): string | undefined {
  if (normalizeDocumentBase(base) !== null) return undefined;
  if (!url.startsWith("/") || url.startsWith("//") || !pageUrl) return undefined;
  let pathname: string;
  try {
    const page = new URL(pageUrl);
    if (page.protocol !== "http:" && page.protocol !== "https:") return undefined;
    pathname = page.pathname;
  } catch {
    return undefined;
  }
  // The page's first folder: "/my-repo/" for /my-repo/ or /my-repo/a/b.html.
  const first = /^\/([^/]+)\//.exec(pathname)?.[1];
  if (!first) return undefined;
  const prefix = `/${first}/`;
  if (url.startsWith(prefix)) return undefined;
  return (
    `If this site is published under ${prefix} (a GitHub Pages project site, for ` +
    `example), add base="${prefix}" to <ml-map> so paths starting with "/" start there.`
  );
}

/**
 * With a `base` set, a file that 404'd was looked up under the base, not next
 * to the page — so the usual page-relative advice is wrong (ml-aot.36). When
 * the page itself is outside the base (a GitHub Pages site previewed locally
 * with `npx serve .` inside the repo folder, so the page is at `/` while
 * files are fetched from `/my-repo/…`), say how to preview it properly.
 *
 * @param resolved - The URL the browser requested (already resolved under the base).
 * @returns The hint, or `undefined` without a base or when `resolved` is not under it
 *   (an absolute URL to another site).
 */
export function baseLookupHint(
  resolved: string,
  pageUrl: string | undefined,
  base: string | null | undefined
): string | undefined {
  const normalized = normalizeDocumentBase(base);
  if (normalized === null || !pageUrl) return undefined;
  let page: URL;
  let baseUrl: URL;
  let target: URL;
  try {
    page = new URL(pageUrl);
    baseUrl = new URL(normalized, page);
    target = new URL(resolved, page);
  } catch {
    return undefined;
  }
  if (page.protocol !== "http:" && page.protocol !== "https:") return undefined;
  const basePath = baseUrl.pathname;
  if (target.origin !== baseUrl.origin || !target.pathname.startsWith(basePath)) return undefined;

  // A base on another site (a CDN): the page's own location says nothing
  // about it, so no local-preview advice (A1).
  if (baseUrl.origin !== page.origin) {
    return (
      `This map's base is "${normalized}", so its files are loaded from there. Check the ` +
      `file name and that the file exists at that address.`
    );
  }

  // base "/" is what Astro passes on a site at the root: the author never
  // set a base, so talk about the site root, not `base="/"` (A1, ml-aot.51).
  if (basePath === "/") {
    return (
      `Paths in this map start at the site root (for an Astro site, the public/ folder), ` +
      `with or without a leading "/", not next to this page. Check the file name and ` +
      `that the file is in that folder.`
    );
  }

  // `astro dev` and `npx serve` serve the base itself as /my-repo, with no
  // trailing slash: that page is at the base, not outside it (A1).
  const pageUnderBase = page.pathname.startsWith(basePath) || page.pathname + "/" === basePath;
  if (!pageUnderBase) {
    const folder = basePath.split("/").filter(Boolean).pop() ?? "";
    return (
      `This page sets base="${normalized}", so files are looked up under ${basePath} — ` +
      `but the page itself is at ${page.pathname}, outside ${basePath}. If you're ` +
      `previewing locally, either remove base while developing, or serve the folder one ` +
      `level up and open ${basePath}. That folder must be named "${folder}" (a GitHub ` +
      `"Download ZIP" folder is called "${folder}-main": rename it).`
    );
  }
  return (
    `This page sets base="${normalized}", so every path (with or without a leading "/") ` +
    `is looked up under ${basePath}, not next to this page. Check the file name and ` +
    `that the file is in that folder.`
  );
}

/**
 * Whether a fetched `src` body is a web page rather than YAML — what a dev
 * server or host with an SPA fallback returns (status 200) for a path that
 * does not exist.
 */
export function looksLikeHtml(body: string, contentType: string | null): boolean {
  const start = body.trimStart().slice(0, 64).toLowerCase();
  if (start.startsWith("<!doctype html") || start.startsWith("<html")) return true;
  return start.startsWith("<") && /text\/html/i.test(contentType ?? "");
}

const PATH_HINT =
  'Check the file name and folder. A path without a leading "/" is relative to ' +
  'this page\'s folder; one starting with "/" starts at the site root.';

/** `fetch(src)` itself threw (no HTTP response at all). */
export function srcFetchFailedCard(
  src: string,
  resolved: string,
  error: unknown,
  filePage: boolean
): ErrorCardContent {
  if (filePage) {
    return {
      title: "Open this page through a local web server",
      errors: [
        {
          path: "",
          message:
            `This page was opened from a file (file://), and browsers block it from ` +
            `loading "${src}" that way.`,
        },
      ],
      hint: FILE_PAGE_HINT,
    };
  }
  const reason = error instanceof Error ? error.message : String(error);
  return {
    title: "Couldn't load the map file",
    errors: [
      {
        path: "",
        message: `Couldn't load src="${src}" (${resolved}): ${reason}.`,
      },
    ],
    hint:
      "The request didn't complete. Check the address and that the server is " +
      "running. A file on another site must allow cross-origin requests (CORS).",
  };
}

/** `src` answered with an HTTP error status. */
export function srcHttpErrorCard(
  src: string,
  resolved: string,
  status: number,
  statusText: string,
  context: { pageUrl?: string; base?: string | null } = {}
): ErrorCardContent {
  const reason = statusText.trim() || STATUS_TEXT[status] || "";
  const baseHint = status === 404 ? subpathBaseHint(src, context.pageUrl, context.base) : undefined;
  const underBase = status === 404 ? baseLookupHint(resolved, context.pageUrl, context.base) : undefined;
  return {
    title: status === 404 ? "Map file not found" : "Couldn't load the map file",
    errors: [
      {
        path: "",
        message: `Couldn't load src="${src}": ${status}${reason ? ` ${reason}` : ""}.`,
      },
      { path: "", message: `The browser looked for it at ${resolved}` },
    ],
    hint: underBase ?? (baseHint ? `${PATH_HINT} ${baseHint}` : PATH_HINT),
  };
}

/** `src` answered 200 with a web page — almost always a wrong path. */
export function srcHtmlCard(
  src: string,
  resolved: string,
  context: { pageUrl?: string; base?: string | null } = {}
): ErrorCardContent {
  const baseHint = subpathBaseHint(src, context.pageUrl, context.base);
  const underBase = baseLookupHint(resolved, context.pageUrl, context.base);
  return {
    title: "Map file not found",
    errors: [
      {
        path: "",
        message:
          `src="${src}" points at an HTML page, not a YAML file — the path is ` +
          `probably wrong.`,
      },
      { path: "", message: `The browser looked for it at ${resolved}` },
    ],
    hint:
      `${underBase ?? PATH_HINT} Many servers answer a missing file with the site's main ` +
      "page instead of a 404, which is why this is an HTML page." +
      (baseHint ? ` ${baseHint}` : ""),
  };
}

/** The worker could not start because the page was opened from disk. */
export function filePageWorkerCard(strings: Strings = defaultStrings): ErrorCardContent {
  return {
    title: strings("maplibre-yaml.ErrorCard.LocalServer"),
    errors: [
      {
        path: "",
        message:
          "This page was opened from a file (file://), and browsers won't start " +
          "the map's background worker for a page opened that way.",
      },
    ],
    hint: strings("maplibre-yaml.ErrorCard.LocalServerHint"),
  };
}

/** Reason phrases for the statuses a beginner meets; HTTP/2 sends none. */
const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  416: "Range Not Satisfiable",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

/**
 * A 416 means the file is there: the server refused the part of it a reader
 * asked for. Pointing at the file name or the folder would send the author
 * the wrong way (ml-aot.114).
 */
const RANGE_REFUSED_HINT =
  "The file was found, but the server refused the part of it that was asked for: the file may " +
  "be incomplete (upload it again), or the server doesn't serve parts of files correctly.";

/** Status-bearing error shapes MapLibre throws (`AJAXError`). */
function statusOf(error: Error): { status?: number; statusText?: string } {
  const e = error as Error & { status?: unknown; statusText?: unknown; cause?: unknown };
  const source = typeof e.status === "number" ? e : (e.cause as typeof e | undefined);
  const status = typeof source?.status === "number" ? source.status : undefined;
  const given = typeof source?.statusText === "string" ? source.statusText.trim() : "";
  const statusText = given || (status !== undefined ? STATUS_TEXT[status] : undefined);
  return { status, statusText };
}

/**
 * The basemap style never loaded (ml-aot.14). `errors` holds every error
 * MapLibre fired for it — one for a failed request, several for a style that
 * failed validation.
 */
export function styleFailureCard(
  errors: Error[],
  options: { url?: string; isV2: boolean; filePage: boolean; strings?: Strings }
): ErrorCardContent {
  const t = options.strings ?? defaultStrings;
  const key = options.isV2 ? "style.basemap" : "config.mapStyle";
  const first = errors[0] ?? new Error("unknown error");
  const where = options.url ? `"${options.url}"` : "the inline style";
  const { status, statusText } = statusOf(first);
  const more = errors.length > 1 ? ` (and ${errors.length - 1} more problem${errors.length > 2 ? "s" : ""})` : "";

  let message: string;
  if (status !== undefined && status >= 400) {
    const statusLine = `${status}${statusText ? ` ${statusText}` : ""}`;
    message = `Could not load the basemap style ${where}: ${statusLine}.`;
    if (status === 404) message += " Nothing exists at that address.";
    if (status === 401 || status === 403) {
      message +=
        " The style server refused the request: keyed styles (MapTiler, Stadia, " +
        "Thunderforest, …) need your API key in the URL, and some only allow approved sites.";
    }
  } else if (status === 0 || /failed to fetch|networkerror|load failed/i.test(first.message)) {
    message = options.filePage
      ? `Could not load the basemap style ${where}: this page was opened from a file (file://).`
      : `Could not load the basemap style ${where}: the request failed. The server could ` +
        "not be reached, or it doesn't allow this site to load the style (CORS).";
  } else if (/json|unexpected token/i.test(first.message)) {
    message =
      `The basemap style ${where} isn't JSON — a URL that returns a web page ` +
      "usually means the address is wrong.";
  } else {
    message =
      `${options.url ? `The basemap style ${where}` : "The inline style"} isn't a valid ` +
      `MapLibre style: ${first.message}${more}.`;
  }

  return {
    title: t("maplibre-yaml.ErrorCard.StyleNotLoaded"),
    errors: [{ path: key, message }],
    hint: options.filePage
      ? t("maplibre-yaml.ErrorCard.LocalServerHint")
      : t("maplibre-yaml.ErrorCard.StyleHint", { key }),
  };
}

/**
 * One document layer was rejected or could not be added. MapLibre's own
 * validation messages lead with `layers.<id>.`; that prefix is dropped (the
 * notice names the layer) and a did-you-mean added where one is cheap.
 */
export function describeLayerProblem(layerId: string, message: string): string {
  let detail = message;
  for (const prefix of [`layers.${layerId}.`, `layers.${layerId}: `]) {
    if (detail.startsWith(prefix)) detail = detail.slice(prefix.length);
  }
  detail = detail.replace(/\s+$/, "");

  // A static value: `color expected, "bleu" found`; inside an expression:
  // `Could not parse color from value 'bleu'`.
  const colour = detail.match(/color expected, "([^"]+)" found|parse color from value '([^']+)'/i);
  const colourHint = colour ? suggestColorName((colour[1] ?? colour[2])!) : undefined;
  const property = detail.match(/unknown property "([^"]+)"/i);
  const propertyHint = property
    ? suggest(property[1]!, [...SPEC_PAINT_KEYS, ...SPEC_LAYOUT_KEYS])
    : undefined;
  const hint = colourHint ?? propertyHint;

  return (
    `Layer \`${layerId}\` didn't draw: ${detail}` +
    (/[.?!]$/.test(detail) ? "" : ".") +
    (hint ? ` Did you mean "${hint}"?` : "")
  );
}

/**
 * A document source failed at runtime (tiles, a TileJSON, a PMTiles archive).
 *
 * @param error - The error itself, when the caller has it: a cloud-native
 *   failure ({@link describeFormatFailure}) that 404'd gets the same `base`
 *   advice a GeoJSON file does.
 */
export function describeSourceProblem(
  sourceId: string,
  message: string,
  error?: unknown,
  context: { pageUrl?: string; base?: string | null; basemap?: boolean } = {}
): string {
  // The basemap's own file (a Protomaps basemap's pmtiles:, or a PMTiles
  // source inside a basemap style): the author never named that source.
  const subject = context.basemap ? "The basemap" : `Source \`${sourceId}\``;
  let text = `${subject} didn't load: ${message.replace(/\s+$/, "")}`;
  const e = error as { failure?: FormatFailure; cause?: { failure?: FormatFailure } } | undefined;
  // A PMTiles tile error crosses MapLibre's worker boundary as a plain
  // error: the message survives, the failure object does not (ml-aot.102).
  const failure = e?.failure ?? e?.cause?.failure ?? httpFailureOf(message);
  if (failure?.code === "http" && failure.status === 404 && context.pageUrl) {
    // Where the browser looked, as for a data file that 404'd.
    const resolved = resolveUrl(failure.url, context.pageUrl);
    if (resolved !== failure.url) text += ` The browser looked for ${resolved}.`;
    const hint =
      baseLookupHint(failure.url, context.pageUrl, context.base) ??
      subpathBaseHint(pathOfSameOrigin(failure.url, context.pageUrl), context.pageUrl, context.base);
    if (hint) text += ` ${hint}`;
  }
  return text;
}

/**
 * The HTTP failure a {@link describeFormatFailure} message states
 * (`` `/data/x.pmtiles` didn't load (404 Not Found). ``), for an error that
 * lost its `failure` on the way.
 */
function httpFailureOf(message: string): FormatFailure | undefined {
  const m = /^`([^`]+)` didn't load \((\d{3})\b/.exec(message);
  return m ? { code: "http", format: "pmtiles", url: m[1]!, status: Number(m[2]) } : undefined;
}

/** `https://host/x/y` on a page at `https://host/…` → `/x/y`; otherwise unchanged. */
function pathOfSameOrigin(url: string, pageUrl: string): string {
  try {
    const target = new URL(url, pageUrl);
    return target.origin === new URL(pageUrl).origin ? target.pathname + target.search : url;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Cloud-native formats (0.9, ml-cnv): PMTiles, FlatGeobuf, GeoParquet and
// COG. One sentence per failure, written for whoever just pointed a map at a
// file.
// ---------------------------------------------------------------------------

/** The format's everyday name, for messages. */
const FORMAT_LABELS: Record<string, string> = {
  pmtiles: "PMTiles",
  flatgeobuf: "FlatGeobuf",
  geoparquet: "GeoParquet",
  cog: "Cloud Optimized GeoTIFF (COG)",
  "protomaps-basemap": "Protomaps basemap",
};

/** The file name at the end of a URL, for command examples. */
function fileNameOf(url: string): string {
  const path = url.replace(/[?#].*$/, "");
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

/** Bytes as "180 MB" (one decimal below 10 MB). */
function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

// ---------------------------------------------------------------------------
// Large FlatGeobuf and GeoParquet files: the ways to make them draw (0.9.2).
// Every size notice and author hint names its cause, then the pathways that
// apply, each with a command to run — written once here so they agree.
// ---------------------------------------------------------------------------

/** The docs site's guides. */
const GUIDES = "https://docs.maplibre-yaml.org/guides/";
/** The Large data guide: which format for how many features, one command per route (0.10 U5, KTD14). */
const LARGE_DATA = `${GUIDES}large-data/`;

/**
 * The docs pages large-data hints link: the Large data guide and the
 * sections they point at (anchors pinned in docs/scripts/check-stable-urls),
 * and each by-view format's own "Large files" section (its limits).
 */
export const LARGE_DATA_DOCS = {
  guide: LARGE_DATA,
  whichFormat: `${LARGE_DATA}#which-format`,
  prepare: `${LARGE_DATA}#mlym-prepare`,
  pmtiles: `${LARGE_DATA}#parcel-fabrics-pmtiles`,
  overviews: `${LARGE_DATA}#overview-geoparquet`,
  classBreaks: `${LARGE_DATA}#class-breaks`,
  mlt: `${LARGE_DATA}#mlt-tiles`,
  geoparquet: `${GUIDES}geoparquet/#large-files`,
  flatgeobuf: `${GUIDES}flatgeobuf/#large-files`,
} as const;

/** A count as "856,687" (English grouping: author hints are English). */
export function formatCount(count: number): string {
  return formatNumber(Math.round(count), {}, "en");
}

/**
 * The file name a command reads: the URL's last segment, or `data.<ext>`
 * for a `blob:` or `data:` URL (the Python preview path), whose name is a
 * UUID or the data itself.
 */
function commandFileName(url: string, ext: string): string {
  return /^(blob|data):/i.test(url) ? `data.${ext}` : fileNameOf(url);
}

/** The file name without its extension: "pluto" for `/data/pluto.parquet`; "data" for a blob. */
export function commandStem(url: string, ext: string): string {
  const name = commandFileName(url, ext);
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).replace(/[^A-Za-z0-9_-]/g, "_") || "data";
}

/**
 * Rewrite a GeoParquet file to read well by view: rows sorted along a
 * Hilbert curve, about 10,000 rows per row group, a `bbox` covering column
 * (added when missing). geoparquet-io (`gpio`) needs nothing installed but
 * `uv`, and packs row groups 1.5–2 × tighter than GDAL's `SORT_BY_BBOX`
 * (measured on NYC PLUTO; see VIEW_DECODE_FACTOR in renderer/cloud-sources).
 * Its row-group size snaps to 10,240.
 */
export function sortedParquetCommand(url: string): string {
  return (
    `\`uvx --from geoparquet-io==1.7.0 gpio sort hilbert ${commandFileName(url, "parquet")} ` +
    `${commandStem(url, "parquet")}-hilbert.parquet --row-group-size 10000 --add-bbox\``
  );
}

/**
 * The `mlym breaks` command for a computed `classify:` the browser can't
 * compute (a source read by view, vector tiles): it prints a `breaks:` line
 * to paste (0.10 U3, U8). `url`: the source's file (`<file>` when unknown).
 */
export function breaksCommand(
  url: unknown,
  c: { field?: unknown; method?: unknown; classes?: unknown; normalize?: unknown; multiply?: unknown }
): string {
  const arg = (v: unknown) => (/^[\w.-]+$/.test(String(v)) ? String(v) : JSON.stringify(String(v)));
  const flag = (name: string, v: unknown) => (v === undefined ? "" : ` --${name} ${arg(v)}`);
  const file = typeof url === "string" && url ? arg(commandFileName(url, "parquet")) : "<file>";
  return (
    `\`mlym breaks ${file}${flag("field", c.field)}${flag("method", String(c.method).trim().toLowerCase())}` +
    `${flag("classes", c.classes)}${flag("normalize", c.normalize)}${flag("multiply", c.multiply)}\``
  );
}

/** Re-create a FlatGeobuf file with a spatial index. */
export function indexedFlatGeobufCommand(url: string): string {
  return `\`ogr2ogr -f FlatGeobuf -lco SPATIAL_INDEX=YES ${commandStem(url, "fgb")}-indexed.fgb ${commandFileName(url, "fgb")}\``;
}

/**
 * Convert a file to PMTiles with tylertoo 0.8.0 (nothing to install but
 * `uv`): the parcel recipe from the PLUTO benchmark (PR #205) and the
 * large-data spike (PR #207) — `collapse_square=True` keeps small polygons
 * visible at coarse zooms, `tile_size_limit=None` stops 0.8.0 dropping
 * features from dense tiles — from zoom 0, so the map draws at every zoom
 * (on PLUTO, zooms 0–9 cost 1.3 s, 0.1 GB and 3.5 MB more than starting at
 * 10: 26 s, 2.1 GB, a 115 MB archive). tylertoo reads GeoParquet, so a
 * FlatGeobuf file is converted first, with geoparquet-io (no GDAL needed).
 */
export function pmtilesCommand(url: string, format: string): string {
  const stem = commandStem(url, format === "geoparquet" ? "parquet" : "fgb");
  return (
    tylertoo(url, format, "", `; t.export_pmtiles('${stem}-ov.parquet', '${stem}.pmtiles', layer_name='${stem}', tile_size_limit=None)`) +
    " (the parcel recipe; MapLibre draws zoom 14's tiles further in)"
  );
}

/**
 * Write an overview GeoParquet file with tylertoo 0.8.0 (the Large data
 * guide's `#overview-geoparquet` route): simplified copies of the data for
 * coarser zooms as extra row groups of one file (`geo:overviews`), from zoom
 * 0, `collapse_square=True` as in the PMTiles recipe, which starts with the
 * same call. Any other `format` (FlatGeobuf, GeoJSON) is converted to
 * GeoParquet first.
 *
 * @param tune - More `overview()` keyword arguments (`"drop_rate=2.5"`).
 */
export function overviewsCommand(url: string, format = "geoparquet", tune = ""): string {
  return tylertoo(url, format, tune ? `, ${tune}` : "", "");
}

/** tylertoo's `overview()` on a file (converted to GeoParquet first unless it is one), then `after`. */
function tylertoo(url: string, format: string, tune: string, after: string): string {
  const gp = format === "geoparquet";
  const stem = commandStem(url, gp ? "parquet" : "fgb");
  return (
    (gp ? "" : `\`uvx --from geoparquet-io==1.7.0 gpio convert geoparquet ${commandFileName(url, "fgb")} ${stem}.parquet\`, then `) +
    `\`uv run --with tylertoo==0.8.0 python -c "import tylertoo as t; t.overview('${gp ? commandFileName(url, "parquet") : `${stem}.parquet`}', ` +
    `'${stem}-ov.parquet', min_zoom=0, max_zoom=14, collapse_square=True${tune})${after}"\``
  );
}

/**
 * The docs links for a large file of `format`: its own "Large files" section
 * and the Large data guide's section for the hint's route.
 */
export function largeDataLinks(format: string, route: "whichFormat" | "overviews" = "whichFormat"): string {
  return `More: ${LARGE_DATA_DOCS[format === "flatgeobuf" ? "flatgeobuf" : "geoparquet"]} and ${LARGE_DATA_DOCS[route]}`;
}

/** What a whole-file read of a file would cost, and the limits it was measured against. */
export interface WholeFileCost {
  format: string;
  /** Features (a FlatGeobuf header's count, a GeoParquet footer's rows). */
  features?: number | undefined;
  /** Bytes transferred (GeoParquet: the columns a map reads, unless `sizeIsFile`). */
  size?: number | undefined;
  /** GeoParquet: the read columns' decoded bytes. */
  decoded?: number | undefined;
  limits?: { features?: number; bytes?: number; decoded?: number } | undefined;
  sizeIsFile?: boolean | undefined;
}

/**
 * The cost of a suggested `maxFeatures`, as a hint words it: "about 3.5 GB of
 * browser memory for parcel-like polygons, less for points".
 */
export function raiseCost(features: number, byView: boolean): string {
  return `about ${memoryEstimateGB(features, byView)} GB of browser memory for parcel-like polygons, less for points`;
}

/**
 * Why a file is too large to load whole, in words — "has 856,687 features,
 * more than a page loads whole (400,000 features)" — and the `maxFeatures` that
 * would load it whole anyway: only when the feature count is all that stands
 * in the way (not the bytes, nor the decoded size), and only up to
 * {@link SAFE_WHOLE_FILE_FEATURES} — a raise that loads the whole of a
 * citywide file froze the page for seconds (formats/large-data).
 */
export function wholeFileCause(cost: WholeFileCost): { text: string; raise?: number } {
  const { features, size, decoded } = cost;
  const limits = cost.limits ?? {};
  const overFeatures = features !== undefined && limits.features !== undefined && features > limits.features;
  const overDecoded = decoded !== undefined && limits.decoded !== undefined && decoded > limits.decoded;
  const overBytes = size !== undefined && limits.bytes !== undefined && size > limits.bytes;
  const columns = cost.format === "geoparquet" && !cost.sizeIsFile ? " (the columns this map reads)" : "";
  const what: string[] = [];
  const over: string[] = [];
  if (overFeatures) {
    what.push(`has ${formatCount(features!)} features`);
    over.push(`${formatCount(limits.features!)} features`);
  }
  if (overDecoded) {
    what.push(`reads columns that decode to ${megabytes(decoded!)}`);
    over.push(`${megabytes(limits.decoded!)} decoded`);
  }
  if (overBytes) {
    what.push(`is ${megabytes(size!)}${columns}`);
    over.push(`${megabytes(limits.bytes!)} transferred`);
  }
  const parts = over.length
    ? [`${what.join(" and ")}, more than a page loads whole (${over.join(", ")})`]
    : [
        // No limits recorded: the count when known, else the size.
        (features !== undefined
          ? `has ${formatCount(features)} features`
          : `is ${size !== undefined ? megabytes(size) : "very large"}${columns}`) + ", too large to load whole in a browser",
      ];
  const text = parts.join(" and ");
  if (!overFeatures || overDecoded || overBytes) return { text };
  const raise = roundedRaise(features!);
  return raise <= SAFE_WHOLE_FILE_FEATURES ? { text, raise } : { text };
}

/** Why a file can't be read by view, and how to change that. */
function blockerAdvice(blocker: FormatFailure["blocker"], url: string, format: string): { why: string; fix: string } | undefined {
  switch (blocker) {
    case "no-bbox":
      return {
        why: "it has no `bbox` covering column",
        fix: `Rewrite it with one, sorted: ${sortedParquetCommand(url)}`,
      };
    case "unsorted":
      return {
        why: "its rows aren't in spatially sorted row groups (each row group spans most of the file, so every view would read most of it)",
        fix: `Sort it: ${sortedParquetCommand(url)}`,
      };
    case "no-index":
      return { why: "it has no spatial index", fix: `Re-create it with one: ${indexedFlatGeobufCommand(url)}` };
    case "no-range":
      return {
        why: "this server doesn't support HTTP range requests",
        fix: "Host it where they work (GitHub Pages, Netlify, Cloudflare, S3, R2; preview locally with `npx serve`, not `python -m http.server`)",
      };
    case "no-size":
      return {
        why: "the server doesn't let this page read the file's size",
        fix: "Have it send `Access-Control-Expose-Headers: Content-Range` (or answer `HEAD` with `Content-Length`)",
      };
    default:
      return format === "geoparquet"
        ? {
            why: "",
            fix: `Reading it by view needs a \`bbox\` column, sorted row groups and a server with range requests: ${sortedParquetCommand(url)}`,
          }
        : { why: "", fix: `Reading it by view needs a spatial index: ${indexedFlatGeobufCommand(url)}` };
  }
}

/**
 * Hosts that serve range requests, and the local preview that doesn't — the
 * advice every range failure ends with.
 */
export const RANGE_REQUEST_HINT =
  "PMTiles, FlatGeobuf, GeoParquet and COG files need a web server that supports HTTP range requests: " +
  "GitHub Pages, Netlify, Cloudflare, S3 and R2 do; `python -m http.server` does not — " +
  "preview locally with `npx serve` instead.";

/**
 * Whether a failure is the live-data chunk's (`chunks/live.js`) failed
 * download. The seam (formats/decoders) reports every chunk under its name as
 * a `format`; `"live"` is no `CloudFormat`, hence the widening cast.
 */
function isLiveChunkFailure(failure: FormatFailure): boolean {
  return failure.code === "chunk" && (failure.format as string) === "live";
}

/**
 * One cloud-native failure, in plain language: what happened to which file
 * and what to do about it. Used as the `message` of every
 * {@link FormatError}, so the notice, the console and the
 * `ml-map:layer-data-error` / `ml-map:error` events all say the same thing.
 */
export function describeFormatFailure(failure: FormatFailure): string {
  // The live-data chunk (polling and streaming) is no file-format reader:
  // its own words, before the reader label (FORMAT_LABELS has no entry).
  if (isLiveChunkFailure(failure)) return describeLiveCodeFailure(failure.url);
  const label = FORMAT_LABELS[failure.format] ?? failure.format;
  const file = `\`${failure.url}\``;
  switch (failure.code) {
    case "no-range":
      return (
        `${file} was served without range-request support (the server sent the whole ` +
        `file instead of the part asked for). ${RANGE_REQUEST_HINT}`
      );
    case "encoded-range":
      return (
        `${file} comes from a server that compresses the parts of files it sends, so the ${label} reader ` +
        "can't read the file a part at a time. Put the file on your own site (GitHub Pages, Netlify and " +
        "`npx serve` work); a file mirrored from GitHub works from fastly.jsdelivr.net, not cdn.jsdelivr.net."
      );
    case "cors":
      return (
        `The browser couldn't read ${file}: the server didn't allow this page to load it ` +
        `(CORS), or it couldn't be reached. A ${label} file on another site needs that ` +
        "site to send `Access-Control-Allow-Origin` and to allow the `Range` header."
      );
    case "not-format":
      return (
        `${file} isn't a ${label} file. A wrong path often returns a web page instead — ` +
        "check the file name and folder."
      );
    case "http": {
      const text = failure.statusText?.trim() || STATUS_TEXT[failure.status ?? 0] || "";
      const line = `${file} didn't load (${failure.status ?? "HTTP error"}${text ? ` ${text}` : ""}).`;
      return failure.status === 416 ? `${line} ${RANGE_REFUSED_HINT}` : line;
    }
    case "too-large": {
      // The cause first (a count when that is what decided, ml-37r.16: the
      // bytes on the wire say little about the decoded size), then why it
      // can't be read by view, then every way to make it draw — each with
      // a command to run (0.9.2 review round).
      const gp = failure.format === "geoparquet";
      const cause = wholeFileCause({ ...failure, format: failure.format });
      const blocked = blockerAdvice(failure.blocker, failure.url, failure.format);
      // Over the limit, a file that can be read by view is (the default):
      // fixing the blocker is enough, `load: viewport` or not.
      const then = "; it is then read by view.";
      const ways = [
        blocked ? `${blocked.fix}${then}` : "",
        cause.raise !== undefined
          ? `Or load it whole anyway with \`load: { maxFeatures: ${cause.raise} }\` (${raiseCost(cause.raise, false)}).`
          : "",
        gp && failure.decoded !== undefined && failure.limits?.decoded !== undefined && failure.decoded > failure.limits.decoded
          ? "Or list fewer `columns:`."
          : "",
        `To draw it at every zoom (a citywide view too), convert it to PMTiles: ${pmtilesCommand(failure.url, failure.format)}.`,
        largeDataLinks(failure.format),
      ].filter(Boolean);
      return (
        `${file} ${cause.text}` +
        (blocked?.why ? `, and it can't be read by view: ${blocked.why}. ` : ". ") +
        ways.join(" ")
      );
    }
    case "no-index":
      if (failure.format === "geoparquet") {
        return (
          `${file} has no \`bbox\` covering column, so it can't be read one part at a time ` +
          "(`load: viewport`). Write it with one, sorted — " +
          `${sortedParquetCommand(failure.url)}, or GeoPandas \`to_parquet(..., write_covering_bbox=True)\` ` +
          "after sorting by `geometry.hilbert_distance()` — or use `load: all`."
        );
      }
      return (
        `${file} has no spatial index, so it can't be read one part at a time ` +
        "(`load: viewport`). Re-create it with an index — `ogr2ogr -f FlatGeobuf -lco " +
        `SPATIAL_INDEX=YES out.fgb ${fileNameOf(failure.url)}\` — or use \`load: all\`.`
      );
    case "crs":
      if (failure.format === "cog") return describeCogProjection(failure);
      return (
        `${file} is in ${failure.crs ?? "a projected coordinate system"}; MapLibre needs ` +
        "longitude/latitude (EPSG:4326). Reproject it: " +
        `\`ogr2ogr -t_srs EPSG:4326 out.${failure.format === "geoparquet" ? "parquet" : "fgb"} ` +
        `${fileNameOf(failure.url)}\`.`
      );
    case "not-geoparquet":
      return (
        `${file} is a Parquet file but not GeoParquet (it has no geometry metadata). Write it ` +
        "with GeoPandas `to_parquet`, `ogr2ogr -f Parquet`, or DuckDB's spatial extension."
      );
    case "encoding":
      return (
        `${file} stores its geometry as GeoArrow${failure.encoding ? ` (\`${failure.encoding}\`)` : ""}, ` +
        "which maplibre-yaml doesn't read yet: it reads GeoParquet with WKB geometry. Rewrite " +
        `it with WKB: \`ogr2ogr -f Parquet -lco GEOMETRY_ENCODING=WKB out.parquet ` +
        `${fileNameOf(failure.url)}\`, or GeoPandas \`to_parquet(..., geometry_encoding="WKB")\`.`
      );
    case "unsupported":
      return (
        `${file} is a ${label} file, which this version of maplibre-yaml can't read. ` +
        "Update maplibre-yaml, or convert the file to a format this version reads."
      );
    case "not-cloud-optimized":
      return (
        `${file} is a GeoTIFF but not a Cloud Optimized one (it has no internal tiles or no ` +
        "overviews), so the browser may download most of the file to draw it. Convert it: " +
        `\`gdal_translate -of COG -co COMPRESS=DEFLATE ${fileNameOf(failure.url)} out.tif\`.`
      );
    case "decoder":
      return (
        `The ${label} reader couldn't be set up${failure.detail ? ` (${failure.detail})` : ""}, ` +
        `so ${file} wasn't read. Other layers are unaffected.`
      );
    case "chunk":
      return (
        `The ${label} reader (${file}) couldn't be downloaded. maplibre-yaml loads its ` +
        "file-format readers on demand from the folder its script came from: if you copied " +
        "maplibre-yaml to your own site, copy the whole `dist/` folder (not just `register.js`), " +
        "or load it from the CDN. Offline or a content blocker can also stop it. Other layers " +
        "are unaffected."
      );
    case "compressed":
      return (
        `${file} is compressed (Zstandard), and this version of maplibre-yaml reads only ` +
        `uncompressed ${label} files. Decompress it (\`zstd -d ${fileNameOf(failure.url)}\`) or ` +
        "write it without compression (`ogr2ogr -f FlatGeobuf` writes an uncompressed file)."
      );
    case "read":
    default:
      return (
        `${file} couldn't be read as ${label}` +
        (failure.detail ? `: ${failure.detail.replace(/[.\s]+$/, "")}.` : ".")
      );
  }
}

/** What stops an on-demand file downloading, and what to do: shared by the reader and live-update notices. */
const CHUNK_HINT =
  "maplibre-yaml loads it on demand from the folder its script came from: if you copied " +
  "maplibre-yaml to your own site, copy the whole `dist/` folder (not just `register.js`), " +
  "or load it from the CDN. Offline or a content blocker can also stop it.";

/** The live-update code (`chunks/live.js`) didn't download: the message of its FormatError. */
function describeLiveCodeFailure(url: string): string {
  return `The live-update code (\`${url}\`) couldn't be downloaded, so live updates are off. ${CHUNK_HINT}`;
}

/**
 * A source with `refresh:` (or a stream) whose live updates couldn't start
 * because their code (`chunks/live.js`, loaded on demand) didn't download.
 * Its first data is on the map; it just won't change. `name` is the (first)
 * layer drawing the source.
 */
export function describeLiveUpdatesStopped(name: string, url: string): string {
  return (
    `\`${name}\` shows the data it loaded first, but its live updates stopped: their code ` +
    `(\`${url}\`) couldn't be downloaded. ${CHUNK_HINT} Reload the map to try again; ` +
    "other layers are unaffected."
  );
}

/**
 * A COG that isn't in Web Mercator — the one projection the COG reader
 * draws — or has no coordinates at all, with the GDAL command that fixes it.
 */
function describeCogProjection(failure: FormatFailure): string {
  const file = `\`${failure.url}\``;
  const name = fileNameOf(failure.url);
  const fix =
    `\`gdalwarp -t_srs EPSG:3857 -of COG -co COMPRESS=DEFLATE ${name} out.tif\`` +
    " (GDAL 3.1 or later).";
  if (failure.crs === undefined) {
    return (
      `${file} has no map coordinates (a plain TIFF image, not a GeoTIFF), so it can't be ` +
      `placed on the map. Georeference it, then make a Web Mercator COG: ${fix}`
    );
  }
  return (
    `${file} is in ${failure.crs}; a COG must be in Web Mercator (EPSG:3857) to be drawn. ` +
    `Reproject it: ${fix}`
  );
}

/**
 * A layer's GeoJSON file did not load. Says which file, why, where the
 * browser actually looked — and, when the document came from a YAML file in
 * another folder, that relative paths resolve against the page.
 */
export function describeDataProblem(
  layerId: string,
  error: Error & { url?: string },
  context: {
    pageUrl?: string;
    documentUrl?: string;
    filePage: boolean;
    /** `<ml-map>`'s `base`, when set (the URL is then already resolved). */
    base?: string | null;
  }
): string {
  const failure = (error as { failure?: FormatFailure }).failure;
  // Live updates that couldn't start (their chunk didn't download): the
  // layer has its first data, so not "has no data" (bundle headroom, KTD8).
  if (failure && isLiveChunkFailure(failure)) {
    return describeLiveUpdatesStopped(layerId, failure.url);
  }
  // A `stream:` that couldn't connect or gave up reconnecting: the layer
  // keeps what it loaded (ml-7qa.12).
  if ((error as { stream?: string }).stream) {
    return `\`${layerId}\` shows the data it has, but isn't getting live updates: ${error.message}.`;
  }
  // A cloud-native file (FlatGeobuf, a reserved format) already carries its
  // own plain-language reason; say which layer it leaves empty.
  if (failure) {
    return (
      `Layer \`${layerId}\` has no data: ${error.message}` +
      (context.filePage ? ` ${FILE_PAGE_HINT}` : "")
    );
  }

  const url = error.url;
  const what = url ? `Data file \`${url}\`` : `The data for layer \`${layerId}\``;

  // A cloud-native file read as JSON because its name doesn't say what it is
  // (ml-aot.123): it loaded fine, so no "didn't load" and no path advice
  // (ml-aot.128).
  const misnamed = /^(Parquet|FlatGeobuf) data from .* without a format$/.exec(error.message);
  if (misnamed) {
    const parquet = misnamed[1] === "Parquet";
    return (
      `${what} was read as JSON, but it is a ${parquet ? "Parquet" : "FlatGeobuf"} file, so layer ` +
      `\`${layerId}\` has no data. Its name doesn't end in ${parquet ? ".parquet" : ".fgb"}: rename it, ` +
      `or add \`format: ${parquet ? "geoparquet" : "flatgeobuf"}\` to the source.`
    );
  }

  let reason: string;
  const http = error.message.match(/^HTTP (\d+):\s*(.*?)\s+for\s/);
  if (http) {
    const text = http[2] || STATUS_TEXT[Number(http[1])] || "";
    reason = `${http[1]}${text ? ` ${text}` : ""}`;
  } else if (/^CSV data from /.test(error.message)) {
    reason =
      "CSV files aren't supported — convert it to GeoJSON (e.g. geojson.io or QGIS); " +
      "see https://docs.maplibre-yaml.org/guides/data-sources/#csv-and-spreadsheets";
  } else if (/^Invalid JSON/i.test(error.message)) {
    reason = "it isn't JSON — a wrong path often returns a web page instead";
  } else if (/not valid GeoJSON/i.test(error.message)) {
    reason = 'it is JSON but not GeoJSON (expected "type": "FeatureCollection")';
  } else if (context.filePage && /fetch|network|load failed/i.test(error.message)) {
    reason = "pages opened from a file (file://) can't load data files";
  } else {
    reason = error.message;
  }

  let text = `${what} didn't load (${reason}), so layer \`${layerId}\` has no data.`;
  if (http?.[1] === "416") {
    // The file is there: no "check the file name" or base advice.
    text += ` ${RANGE_REFUSED_HINT}`;
  } else if (url && context.pageUrl) {
    const resolved = resolveUrl(url, context.pageUrl);
    if (resolved !== url) text += ` The browser looked for ${resolved}`;
    if (
      context.documentUrl &&
      isRelativeReference(url) &&
      directoryOf(context.documentUrl) !== directoryOf(context.pageUrl)
    ) {
      const besideYaml = resolveUrl(url, context.documentUrl);
      const pageDir = directoryOf(context.pageUrl);
      const fromPage = besideYaml.startsWith(pageDir)
        ? besideYaml.slice(pageDir.length)
        : new URL(besideYaml).pathname;
      text +=
        ` — relative paths start from the page, not from the YAML file. If the file ` +
        `is next to your YAML, write \`${fromPage}\`.`;
    } else if (resolved !== url) {
      text += ".";
    }
    const baseHint = http
      ? (baseLookupHint(resolved, context.pageUrl, context.base) ??
        subpathBaseHint(url, context.pageUrl, context.base))
      : undefined;
    if (baseHint) text += ` ${baseHint}`;
  }
  if (context.filePage) text += ` ${FILE_PAGE_HINT}`;
  return text;
}

/** `config.fitTo.source` names no source (ml-aot.51). */
export function describeFitToProblem(source: string, suggestion?: string): string {
  return (
    `fitTo.source "${source}" names no source in sources:` +
    (suggestion ? ` — did you mean "${suggestion}"?` : ".") +
    " The map keeps its own center and zoom."
  );
}

/** `config.center` written [latitude, longitude] (ml-aot.65). */
export function describeSwappedCenter(center: [number, number], suggestion: [number, number]): string {
  const pair = (p: [number, number]) => `[${p[0]}, ${p[1]}]`;
  return (
    `\`center\` is ${pair(center)}, but this map's data is around ${pair(suggestion)}. ` +
    `Coordinates are [longitude, latitude]: did you mean center: ${pair(suggestion)}?`
  );
}

/** A declared `images:` entry failed. */
export function describeImageProblem(name: string, url: string): string {
  return `Image \`${name}\` (${url}) didn't load, so layers using it draw without it.`;
}

/** A marker icon failed; the default pin stands in. */
export function describeMarkerIconProblem(index: number, icon: string): string {
  return `Marker ${index + 1}'s icon (${icon}) didn't load, so it shows the default pin.`;
}

/** The URL up to and including its last `/` (query and hash dropped). */
function directoryOf(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.href.slice(0, parsed.href.lastIndexOf("/") + 1);
  } catch {
    return url.slice(0, url.lastIndexOf("/") + 1);
  }
}

/**
 * A changed document was refused and the running map kept (live documents,
 * KTD9): the first problem, and how many more. An author hint — the
 * `ml-map:update-rejected` event carries them all.
 */
export function describeRejectedUpdate(errors: ReadonlyArray<{ path?: string; message: string }>): string {
  const first = errors[0];
  const where = first?.path ? `${first.path}: ` : "";
  const more = errors.length > 1 ? ` (and ${errors.length - 1} more)` : "";
  return `The map kept its last document — the new one has a problem${more}: ${where}${first?.message ?? "unknown"}`;
}

/** `src` changed but the file didn't load while a map was running (KTD12): the map is kept. */
export function describeFetchRejection(src: string, resolved: string, reason: string): string {
  return `The map kept its last document: src="${src}" didn't load (${reason}). The browser looked for it at ${resolved}.`;
}

/** A basemap change whose new style never loaded (KTD8): the old map is kept. */
export function describeStyleRejection(key: string, url: string | undefined, reason: string): string {
  return `The map kept its last basemap: the new \`${key}\`${url ? ` (${url})` : ""} didn't load — ${reason}`;
}

/** A document layer's id is already a layer the page added through the map (KTD1): the document never adopts it. */
export function describeHostLayerCollision(layerId: string): string {
  return `Layer \`${layerId}\` wasn't updated: the page added a layer with that id through getMap() or addLayer(), and the document never adopts a layer it didn't declare. Give one of them another id.`;
}
