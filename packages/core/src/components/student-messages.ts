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
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

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
  context: { pageUrl?: string; base?: string | null } = {}
): string {
  let text = `Source \`${sourceId}\` didn't load: ${message.replace(/\s+$/, "")}`;
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
// Cloud-native formats (0.9, ml-cnv): PMTiles, FlatGeobuf — and the two the
// syntax reserves (GeoParquet, COG). One sentence per failure, written for
// the student who just pointed a map at a file.
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

/**
 * Hosts that serve range requests, and the local preview that doesn't — the
 * advice every range failure ends with.
 */
export const RANGE_REQUEST_HINT =
  "PMTiles and FlatGeobuf files need a web server that supports HTTP range requests: " +
  "GitHub Pages, Netlify, Cloudflare, S3 and R2 do; `python -m http.server` does not — " +
  "preview locally with `npx serve` instead.";

/**
 * One cloud-native failure, in plain language: what happened to which file
 * and what to do about it. Used as the `message` of every
 * {@link FormatError}, so the notice, the console and the
 * `ml-map:layer-data-error` / `ml-map:error` events all say the same thing.
 */
export function describeFormatFailure(failure: FormatFailure): string {
  const label = FORMAT_LABELS[failure.format] ?? failure.format;
  const file = `\`${failure.url}\``;
  switch (failure.code) {
    case "no-range":
      return (
        `${file} was served without range-request support (the server sent the whole ` +
        `file instead of the part asked for). ${RANGE_REQUEST_HINT}`
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
      return `${file} didn't load (${failure.status ?? "HTTP error"}${text ? ` ${text}` : ""}).`;
    }
    case "too-large":
      return (
        `${file} is ${failure.size !== undefined ? megabytes(failure.size) : "very large"}, ` +
        "too large to load whole in a browser. Add `load: viewport` to the source (the file " +
        "needs a spatial index), or convert it to PMTiles."
      );
    case "no-index":
      return (
        `${file} has no spatial index, so it can't be read one part at a time ` +
        "(`load: viewport`). Re-create it with an index — `ogr2ogr -f FlatGeobuf -lco " +
        `SPATIAL_INDEX=YES out.fgb ${fileNameOf(failure.url)}\` — or use \`load: all\`.`
      );
    case "crs":
      return (
        `${file} is in ${failure.crs ?? "a projected coordinate system"}; MapLibre needs ` +
        "longitude/latitude (EPSG:4326). Reproject it: " +
        `\`ogr2ogr -t_srs EPSG:4326 out.fgb ${fileNameOf(failure.url)}\`.`
      );
    case "unsupported":
      return failure.format === "cog"
        ? `${file} is a ${label}, which this version of maplibre-yaml can't read on its ` +
            "own yet (it's planned). For now, convert it to PMTiles raster tiles, or " +
            "register the `cog://` protocol from page JavaScript."
        : `${file} is a ${label} file, which this version of maplibre-yaml can't read yet ` +
            "(it's planned). For now, convert it to FlatGeobuf or GeoJSON: " +
            `\`ogr2ogr out.fgb ${fileNameOf(failure.url)}\`.`;
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
  // A cloud-native file (FlatGeobuf, a reserved format) already carries its
  // own plain-language reason; say which layer it leaves empty.
  if ((error as { failure?: FormatFailure }).failure) {
    return (
      `Layer \`${layerId}\` has no data: ${error.message}` +
      (context.filePage ? ` ${FILE_PAGE_HINT}` : "")
    );
  }

  const url = error.url;
  const what = url ? `Data file \`${url}\`` : `The data for layer \`${layerId}\``;

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
  if (url && context.pageUrl) {
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
