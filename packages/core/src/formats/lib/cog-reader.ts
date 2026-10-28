/**
 * @file What the `cog://` protocol does with a request, in the `cog` chunk (0.9, ml-cnv.2; bundle headroom U5)
 * @module @maplibre-yaml/core/formats/lib/cog-reader
 *
 * @description
 * A Cloud Optimized GeoTIFF is one image file — imagery, elevation, or a
 * single band of values — laid out so a browser can read just the tiles it
 * draws, with HTTP range requests. `@geomatico/maplibre-cog-protocol` turns
 * those reads into map tiles (decoding in a geotiff.js worker pool).
 *
 * This adapter travels in the `cog` chunk (`chunks/cog.js`) beside the
 * plugin, geotiff.js and core's header reader, so a page with no COG
 * carries none of it. The main bundle keeps the `cog://` registration
 * (formats/cog-protocol.ts), which hands each request to {@link handle}
 * once the chunk has loaded, and gives the chunk what it uses of core as a
 * {@link CogHost} ({@link useHost}): this module imports core as types only,
 * apart from the leaf formats/cog.ts.
 *
 * Before the plugin reads a file, {@link handle} reads its first 64 KB once
 * ({@link preflight}) — and, for a GeoTIFF whose directory lies past them,
 * the part that holds it — to say plainly what the plugin can't: a server
 * without range requests, a CORS refusal, a missing file, a web page saved
 * under a `.tif` name, a GeoTIFF that isn't in Web Mercator (the plugin
 * would draw it blank, with no error), or one that isn't cloud-optimized (a
 * hint: it draws, but the browser may download most of it).
 *
 * Never imports maplibre-gl: MapLibre calls the handler; nothing here calls
 * MapLibre.
 */

import { cogProtocol } from "@geomatico/maplibre-cog-protocol";
import type { CogHost } from "../../renderer/cloud-host";
import { isCloudOptimized, readCogHeaderParts, type CogHeader, type FilePart } from "../cog-header";
import { fileUrlOf, HEADER_BYTES, type CogHintReporter, type CogRequest } from "../cog";
import { dropFirstBlock, shareFirstBlock } from "./cog-first-block";

// ---------------------------------------------------------------------------
// The host (renderer/cloud-host)
// ---------------------------------------------------------------------------

let bound: CogHost | undefined;

/**
 * Give this chunk what it uses from core. The main bundle calls it once, as
 * the chunk loads (`cogReader` in formats/cog-protocol), before any request
 * reaches {@link handle}.
 */
export function useHost(host: CogHost): void {
  bound = host;
}

function host(): CogHost {
  if (!bound) throw new Error("maplibre-yaml: the COG reader ran before core gave it its host (useHost)");
  return bound;
}

/**
 * Whether `error` is a `FormatError`. Duck-typed, as formats/errors's own
 * (which this chunk doesn't import: its class pulls in the message catalogue).
 */
function isFormatError(error: unknown): boolean {
  const failure = (error as { failure?: { code?: unknown; format?: unknown } } | null)?.failure;
  return typeof failure?.code === "string" && typeof failure?.format === "string";
}

/** Whether an error is an abort (a superseded request), never worth reporting (as formats/errors's). */
function isAbortError(error: unknown): boolean {
  const e = error as { name?: unknown; message?: unknown } | null;
  return e?.name === "AbortError" || /\baborted?\b/i.test(String(e?.message ?? ""));
}

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

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
  const { formatError } = host();
  const message = String((error as { message?: unknown } | null)?.message ?? error);
  const base = { format: "cog" as const, url };
  if (/responded with full file/i.test(message)) return formatError({ ...base, code: "no-range" });
  // An image codec in its own file next to the reader (chunks/cog-<codec>.js,
  // ml-cnv.11) that couldn't be downloaded: the seam's "chunk" notice.
  const codec = /\S*cog-(?:deflate|jpeg|lerc|zstd)\.js/.exec(message);
  if (codec && /dynamically imported module|importing a module script failed|failed to fetch/i.test(message)) {
    return formatError({ code: "chunk", format: "cog", url: codec[0], detail: message });
  }
  const projection = /COG projection (EPSG:\d+)/i.exec(message);
  if (projection) return formatError({ ...base, code: "crs", crs: projection[1]! });
  if (/invalid (byte order|magic)|not a (valid )?tiff|unsupported (tiff|file)/i.test(message)) {
    return formatError({ ...base, code: "not-format" });
  }
  if (/failed to fetch|networkerror|load failed|network request failed|request failed/i.test(message)) {
    return formatError({ ...base, code: "cors" });
  }
  if (/worker/i.test(message) && /security|denied|refused|policy/i.test(message)) {
    return formatError({ ...base, code: "decoder", detail: WORKER_BLOCKED });
  }
  return formatError({ ...base, code: "read", detail: message });
}

/** Why the reader can't run where a strict CSP blocks `blob:` workers. */
const WORKER_BLOCKED =
  "this page's Content Security Policy doesn't allow the background workers COG images are " +
  "decoded in; allow them with `worker-src 'self' blob:`";

/** How many reads past the first one a header may take (an IFD-last file needs one or two). */
const MORE_HEADER_READS = 3;

/**
 * `length` bytes (at least {@link HEADER_BYTES}) of the file from `offset`,
 * or `undefined` when they can't be had (past the end, a refused range):
 * the header is then left to the plugin.
 */
async function readMore(fileUrl: string, offset: number, length: number): Promise<FilePart | undefined> {
  try {
    const response = await fetch(fileUrl, {
      headers: { Range: `bytes=${offset}-${offset + Math.max(length, HEADER_BYTES) - 1}` },
    });
    if (response.status !== 206) {
      void response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length >= length ? { start: offset, bytes } : undefined;
  } catch {
    return undefined;
  }
}

/** The preflight's bytes by file URL, until the reader's first request takes them. */
const firstBlocks = new Map<string, { bytes: Uint8Array; contentRange: string | null }>();

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
  const { formatError, consoleText, takeHeaderRead } = host();
  const shown = displayUrl(fileUrl);
  const base = { format: "cog" as const, url: shown };
  let response: Response;
  try {
    // The main bundle may have started this read while the chunk downloaded.
    response = await (takeHeaderRead(fileUrl) ??
      fetch(fileUrl, { headers: { Range: `bytes=0-${HEADER_BYTES - 1}` } }));
  } catch {
    throw formatError({ ...base, code: "cors" });
  }
  if (response.status === 416) {
    // The first 64 KB of a file can only be unsatisfiable when the file is
    // empty (a shorter file gets its whole length back, from every host).
    void response.body?.cancel().catch(() => undefined);
    throw formatError({ ...base, code: "not-format" });
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw formatError({
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
    throw formatError({ ...base, code: "no-range" });
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  // The reader asks for the same 64 KB first: it gets these (./cog-first-block).
  firstBlocks.set(fileUrl, { bytes, contentRange: response.headers.get("content-range") });
  const parts: FilePart[] = [{ start: 0, bytes }];
  let header = readCogHeaderParts(parts);
  // A GeoTIFF written "IFD last" (not by GDAL's COG driver) keeps its
  // directory and GeoKeys past the first read: read where they are, so a
  // file in the wrong projection is still caught. A few reads at most.
  for (let reads = 0; typeof header === "object" && "missing" in header && reads < MORE_HEADER_READS; reads++) {
    const more = await readMore(fileUrl, header.missing.offset, header.missing.length);
    if (!more) break;
    parts.push(more);
    header = readCogHeaderParts(parts);
  }
  if (header === "not-tiff") throw formatError({ ...base, code: "not-format" });
  if ("missing" in header) return undefined; // the plugin reads the file as it can
  if (!header.webMercator) {
    throw formatError({ ...base, code: "crs", ...(header.crs ? { crs: header.crs } : {}) });
  }
  if (!isCloudOptimized(header)) {
    // The error's own message is the wording (describeFormatFailure), kept in the main bundle.
    const message = formatError({ ...base, code: "not-cloud-optimized" }).message;
    console.warn(`[maplibre-yaml] ${consoleText(message)}`);
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
    throw host().formatError({ format: "cog", url: shown, code: "decoder", detail: WORKER_BLOCKED });
  }
  if (params.type === "json") await preflight(fileUrl, report);
  // The file's first 64 KB, already read: the reader's first request gets them.
  const block = params.type === "json" ? firstBlocks.get(fileUrl) : undefined;
  if (block) {
    firstBlocks.delete(fileUrl);
    shareFirstBlock(fileUrl, block);
  }
  try {
    return (await cogProtocol(params as never)) as { data: unknown };
  } catch (error) {
    throw classifyCogError(error, shown);
  } finally {
    if (block) dropFirstBlock(fileUrl);
  }
}
