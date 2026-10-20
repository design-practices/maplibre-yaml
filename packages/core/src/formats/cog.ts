/**
 * @file COG: what the `cog://` protocol does with a request (0.9, ml-cnv.2)
 * @module @maplibre-yaml/core/formats/cog
 *
 * @description
 * A Cloud Optimized GeoTIFF is one image file — imagery, elevation, or a
 * single band of values — laid out so a browser can read just the tiles it
 * draws, with HTTP range requests. `@geomatico/maplibre-cog-protocol` turns
 * those reads into map tiles (decoding in a geotiff.js worker pool).
 *
 * This module stays in the main bundle and is small. The library itself —
 * the plugin and geotiff.js — is reached only through `getDecoder("cog")`
 * (`chunks/cog.js`, ml-7qa.5), on a COG's first request, so a page with no
 * COG never downloads it. `./cog-protocol` registers the `cog://` handler
 * that calls {@link handle} before any map is created.
 *
 * Before the plugin reads a file, {@link handle} reads its first 64 KB once
 * ({@link preflight}), to say plainly what the plugin can't: a server
 * without range requests, a CORS refusal, a missing file, a web page saved
 * under a `.tif` name, a GeoTIFF that isn't in Web Mercator (the plugin
 * would draw it blank, with no error), or one that isn't cloud-optimized (a
 * hint: it draws, but the browser may download most of it).
 *
 * Never imports maplibre-gl: MapLibre calls the handler; nothing here calls
 * MapLibre.
 */

import { getDecoder } from "./decoders";
import type { CogHeader } from "./cog-header";
import { FormatError, isAbortError, isFormatError } from "./errors";
import { describeFormatFailure } from "../components/student-messages.js";

/** How much of the file the preflight reads: any COG's header fits. */
const HEADER_BYTES = 65536;

/** A request MapLibre sends a protocol handler (the fields used here). */
export interface CogRequest {
  url: string;
  type?: string;
}

/** Called once per file that draws but isn't cloud-optimized: the hint to show. */
export type CogHintReporter = (fileUrl: string, message: string) => void;

/** The URL as a reader sees it: a same-origin path, else the full URL. */
function displayUrl(url: string): string {
  try {
    const here = typeof location !== "undefined" ? location : undefined;
    const target = new URL(url, here?.href);
    return here && target.origin === here.origin ? target.pathname + target.search : url;
  } catch {
    return url;
  }
}

/** The file URL inside a `cog://` request (scheme, fragment and tile suffix dropped). */
export function fileUrlOf(requestUrl: string): string {
  const inner = requestUrl.replace(/^cog:\/\//i, "");
  const hash = inner.indexOf("#");
  const file = hash === -1 ? inner : inner.slice(0, hash);
  return file.replace(/\/\d+\/\d+\/\d+$/, "");
}

/**
 * Whether this page may start workers from `blob:` URLs, which the COG
 * reader decodes in. A Content Security Policy without `blob:` in
 * `worker-src` refuses them — not with an exception: the worker just never
 * starts, and every tile would wait forever. So one tiny worker is started
 * first and must answer. Asked once per page.
 */
let workersAllowed: Promise<boolean> | undefined;

function blobWorkersAllowed(): Promise<boolean> {
  workersAllowed ??= new Promise<boolean>((resolve) => {
    if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL?.createObjectURL !== "function") {
      resolve(true); // not a browser: nothing to decide here
      return;
    }
    let href: string | undefined;
    let worker: Worker | undefined;
    const done = (allowed: boolean) => {
      clearTimeout(timer);
      worker?.terminate();
      if (href) URL.revokeObjectURL(href);
      resolve(allowed);
    };
    // No answer at all (a very busy page): don't block reading on it.
    const timer = setTimeout(() => done(true), 5000);
    try {
      href = URL.createObjectURL(new Blob(["postMessage(1)"], { type: "text/javascript" }));
      worker = new Worker(href);
      worker.onmessage = () => done(true);
      worker.onerror = () => done(false);
    } catch {
      done(false);
    }
  });
  return workersAllowed;
}

/**
 * Classify what the plugin (or geotiff.js under it) threw.
 *
 * @param error - The raw error.
 * @param url - The file, as the message should name it.
 */
export function classifyCogError(error: unknown, url: string): unknown {
  if (isAbortError(error) || isFormatError(error)) return error;
  const message = String((error as { message?: unknown } | null)?.message ?? error);
  const base = { format: "cog" as const, url };
  if (/responded with full file/i.test(message)) return new FormatError({ ...base, code: "no-range" });
  const projection = /COG projection (EPSG:\d+)/i.exec(message);
  if (projection) return new FormatError({ ...base, code: "crs", crs: projection[1]! });
  if (/invalid (byte order|magic)|not a (valid )?tiff|unsupported (tiff|file)/i.test(message)) {
    return new FormatError({ ...base, code: "not-format" });
  }
  if (/failed to fetch|networkerror|load failed|network request failed|request failed/i.test(message)) {
    return new FormatError({ ...base, code: "cors" });
  }
  if (/worker/i.test(message) && /security|denied|refused|policy/i.test(message)) {
    return new FormatError({ ...base, code: "decoder", detail: WORKER_BLOCKED });
  }
  return new FormatError({ ...base, code: "read", detail: message });
}

/** Why the reader can't run where a strict CSP blocks `blob:` workers. */
const WORKER_BLOCKED =
  "this page's Content Security Policy doesn't allow the background workers COG images are " +
  "decoded in; allow them with `worker-src 'self' blob:`";

/** Preflight results by file URL: a header read once per file per page. */
const preflights = new Map<string, Promise<CogHeader | undefined>>();

/**
 * Read a COG's first bytes once and check what the plugin can't.
 *
 * @returns The header (or `undefined` when it reaches past what was read:
 *   the plugin then reads the file as it can).
 * @throws {FormatError} `cors`, `http`, `no-range`, `not-format`, `crs`.
 *   A failure is not kept: a reload asks again.
 */
export function preflight(fileUrl: string, report?: CogHintReporter): Promise<CogHeader | undefined> {
  let pending = preflights.get(fileUrl);
  if (!pending) {
    // Not tied to one request's abort signal: several maps (or a reload)
    // may wait on the same read.
    pending = readHeader(fileUrl, report);
    preflights.set(fileUrl, pending);
    pending.catch(() => {
      if (preflights.get(fileUrl) === pending) preflights.delete(fileUrl);
    });
  }
  return pending;
}

async function readHeader(fileUrl: string, report: CogHintReporter | undefined): Promise<CogHeader | undefined> {
  const shown = displayUrl(fileUrl);
  const base = { format: "cog" as const, url: shown };
  let response: Response;
  try {
    response = await fetch(fileUrl, { headers: { Range: `bytes=0-${HEADER_BYTES - 1}` } });
  } catch {
    throw new FormatError({ ...base, code: "cors" });
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new FormatError({
      ...base,
      code: "http",
      status: response.status,
      ...(response.statusText ? { statusText: response.statusText } : {}),
    });
  }
  if (response.status !== 206) {
    // The whole file came back instead of the part asked for: the plugin's
    // reads would each download all of it (and geotiff.js refuses).
    void response.body?.cancel().catch(() => undefined);
    throw new FormatError({ ...base, code: "no-range" });
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  // The header reader travels in the COG chunk (formats/lib/cog.ts).
  const { readCogHeader, isCloudOptimized } = await getDecoder("cog");
  const header = readCogHeader(bytes);
  if (header === "not-tiff") throw new FormatError({ ...base, code: "not-format" });
  if (header === "truncated") return undefined;
  if (!header.webMercator) {
    throw new FormatError({ ...base, code: "crs", ...(header.crs ? { crs: header.crs } : {}) });
  }
  if (!isCloudOptimized(header)) {
    const message = describeFormatFailure({ ...base, code: "not-cloud-optimized" });
    console.warn(`[maplibre-yaml] ${message.replace(/`/g, '"')}`);
    report?.(fileUrl, message);
  }
  return header;
}

/**
 * The `cog://` protocol handler: preflight on the TileJSON request, then the
 * plugin; every failure in plain words.
 *
 * @param params - MapLibre's request (`type: "json"` for the source's
 *   TileJSON, `"image"` for a tile).
 * @param _abortController - MapLibre's (the plugin reads through its own cache).
 * @param report - Where a not-cloud-optimized hint goes.
 */
export async function handle(
  params: CogRequest,
  _abortController?: AbortController,
  report?: CogHintReporter
): Promise<{ data: unknown }> {
  const fileUrl = fileUrlOf(params.url);
  const shown = displayUrl(fileUrl);
  if (!(await blobWorkersAllowed())) {
    throw new FormatError({ format: "cog", url: shown, code: "decoder", detail: WORKER_BLOCKED });
  }
  if (params.type === "json") await preflight(fileUrl, report);
  try {
    // The library itself (`chunks/cog.js`), downloaded on demand; a failed
    // download is a FormatError ("chunk") that names the file.
    const { cogProtocol } = await getDecoder("cog");
    return (await cogProtocol(params as never)) as { data: unknown };
  } catch (error) {
    throw classifyCogError(error, shown);
  }
}
