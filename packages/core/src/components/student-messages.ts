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

/** The fix for a page opened from disk. */
export const FILE_PAGE_HINT =
  "Start a local web server in this page's folder — for example, run " +
  '"npx serve ." in a terminal there, or use VS Code\'s "Live Server" ' +
  "extension — then open the http://localhost address it prints.";

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

  const pageUnderBase = page.origin === baseUrl.origin && page.pathname.startsWith(basePath);
  if (!pageUnderBase) {
    return (
      `This page sets base="${normalized}", so files are looked up under ${basePath} — ` +
      `but the page itself is at ${page.pathname}, outside ${basePath}. If you're ` +
      `previewing locally, serve the parent folder so this page opens at ${basePath}, ` +
      `or remove base while developing.`
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
export function filePageWorkerCard(): ErrorCardContent {
  return {
    title: "Open this page through a local web server",
    errors: [
      {
        path: "",
        message:
          "This page was opened from a file (file://), and browsers won't start " +
          "the map's background worker for a page opened that way.",
      },
    ],
    hint: FILE_PAGE_HINT,
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
  options: { url?: string; isV2: boolean; filePage: boolean }
): ErrorCardContent {
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
    title: "The basemap style didn't load",
    errors: [{ path: key, message }],
    hint: options.filePage
      ? FILE_PAGE_HINT
      : `Check ${key}: open the URL in a new browser tab to see what it returns. A ` +
        'MapLibre style is a JSON file with "version": 8, "sources" and "layers" — a ' +
        "tile URL, a GeoJSON file or a web page won't work. To test quickly, use " +
        '"https://demotiles.maplibre.org/style.json".',
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

/** A document source failed at runtime (tiles, a TileJSON). */
export function describeSourceProblem(sourceId: string, message: string): string {
  return `Source \`${sourceId}\` didn't load: ${message.replace(/\s+$/, "")}`;
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
  const url = error.url;
  const what = url ? `Data file \`${url}\`` : `The data for layer \`${layerId}\``;

  let reason: string;
  const http = error.message.match(/^HTTP (\d+):\s*(.*?)\s+for\s/);
  if (http) {
    const text = http[2] || STATUS_TEXT[Number(http[1])] || "";
    reason = `${http[1]}${text ? ` ${text}` : ""}`;
  } else if (/^Invalid JSON/i.test(error.message)) {
    reason = "it isn't JSON — a wrong path often returns a web page instead";
  } else if (/not valid GeoJSON/i.test(error.message)) {
    reason = "it isn't GeoJSON";
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
