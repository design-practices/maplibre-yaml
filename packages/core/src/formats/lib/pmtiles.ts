/**
 * @file The PMTiles library and its failure path as the `pmtiles` on-demand chunk sees it (0.9, ml-cnv.1; bundle headroom U5)
 * @module @maplibre-yaml/core/formats/lib/pmtiles
 *
 * @description
 * The `pmtiles` library (the protocol reader and the archive class), and
 * what core says when it fails on an archive: the library's raw strings put
 * in plain words, and the compressed-host check (a host whose range replies
 * are cut from a compressed copy). The main bundle keeps the `pmtiles://`
 * registration and the metadata reads (formats/pmtiles.ts); a request that
 * fails is handed to {@link tileFailure}, which reaches core through the
 * {@link PmtilesHost} given at load ({@link useHost}). A TileJSON reply
 * passes through {@link withEncoding} (an MLT archive's `encoding`), and the
 * MLT notices are worded here ({@link mltNotice}). This module imports core
 * as types only (see the seam, formats/decoders.ts).
 */

import type { Protocol } from "pmtiles";
import type { PmtilesHost } from "../../renderer/cloud-host";

export { PMTiles, Protocol } from "pmtiles";

let bound: PmtilesHost | undefined;

/** Give this chunk what it uses from core: formats/pmtiles.ts calls it as the chunk loads. */
export function useHost(host: PmtilesHost): void {
  bound = host;
}

function host(): PmtilesHost {
  if (!bound) throw new Error("maplibre-yaml: the PMTiles reader ran before core gave it its host (useHost)");
  return bound;
}

/** Whether `error` is a `FormatError` (duck-typed, as formats/errors's own). */
function isFormatError(error: unknown): error is { failure: { code: string } } {
  const failure = (error as { failure?: { code?: unknown; format?: unknown } } | null)?.failure;
  return typeof failure?.code === "string" && typeof failure?.format === "string";
}

/** Whether an error is an abort (a superseded request), never worth reporting (as formats/errors's). */
function isAbortError(error: unknown): boolean {
  const e = error as { name?: unknown; message?: unknown } | null;
  return e?.name === "AbortError" || /\baborted?\b/i.test(String(e?.message ?? ""));
}

/** A network-level failure (`fetch` rejected: CORS, DNS, offline). */
function isNetworkFailure(message: string): boolean {
  return /failed to fetch|networkerror|load failed|network request failed/i.test(message);
}

/**
 * Classify what the `pmtiles` library threw for an archive.
 *
 * @param error - The raw error.
 * @param url - The archive URL (without the `pmtiles://` scheme).
 * @returns The classified error; aborts are returned unchanged.
 */
export function classifyPmtilesError(error: unknown, url: string): unknown {
  if (isAbortError(error) || isFormatError(error)) return error;
  const { formatError } = host();
  const message = String((error as { message?: unknown } | null)?.message ?? error);
  const base = { format: "pmtiles" as const, url };
  if (/content-length exceeding request|byte serving/i.test(message)) {
    return formatError({ ...base, code: "no-range" });
  }
  // A server that refused the first range (16 KB from the start) of an
  // archive shorter than that, and hid its `Content-Range` from this page:
  // the reader can't learn the size to ask again. Ranges work; the file is
  // fine — the host's CORS headers are what is missing.
  if (/missing content-length on 416/i.test(message)) {
    return formatError({
      ...base,
      code: "read",
      detail:
        "the server refused the first range request and didn't let this page read the file size " +
        "(it needs to send `Access-Control-Expose-Headers: Content-Range`)",
    });
  }
  if (/wrong magic number/i.test(message) || /spec version/i.test(message)) {
    return formatError({ ...base, code: "not-format" });
  }
  const status = /bad response code:\s*(\d+)/i.exec(message);
  if (status) return formatError({ ...base, code: "http", status: Number(status[1]) });
  if (isNetworkFailure(message)) return formatError({ ...base, code: "cors" });
  return error;
}

/** The archive URL inside a `pmtiles://` request URL (tile suffix dropped). */
function archiveUrl(requestUrl: string): string {
  const inner = requestUrl.replace(/^pmtiles:\/\//i, "");
  // Tile requests are `pmtiles://<archive>/{z}/{x}/{y}`.
  return inner.replace(/\/\d+\/\d+\/\d+(?:\.\w+)?$/, "");
}

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
 * What a failed `pmtiles://` request reports: the library's error in plain
 * words — or, for a reply that couldn't be read or bytes that aren't the
 * archive's from a host that serves the file compressed (its range replies
 * are cut from the compressed copy: jsDelivr's Cloudflare leg), the
 * `encoded-range` notice. That last check is asked once per archive per
 * registration (`encoded`).
 *
 * @param error - What the library threw.
 * @param requestUrl - The request's `pmtiles://` URL.
 * @param encoded - Per archive: whether its range replies can't be read.
 */
export async function tileFailure(
  error: unknown,
  requestUrl: string,
  encoded: Record<string, Promise<boolean>>
): Promise<unknown> {
  const archive = archiveUrl(requestUrl);
  const classified = classifyPmtilesError(error, displayUrl(archive));
  const code = isFormatError(classified) ? classified.failure.code : undefined;
  if (code === "cors" || code === "not-format") {
    encoded[archive] ??= host().rangeRepliesUnreadable(archive);
    if (await encoded[archive]) {
      return host().formatError({ code: "encoded-range", format: "pmtiles", url: displayUrl(archive) });
    }
  }
  return classified;
}

/** The PMTiles header's tile type for MLT (`TileType.Mlt`). */
const MLT = 6;

/**
 * A `pmtiles://` reply as MapLibre gets it: the TileJSON of an archive whose
 * header says MLT gets `encoding: "mlt"` (0.10, U4; KTD9), on a maplibre-gl
 * that draws MLT (`drawsMlt`, which formats/pmtiles.ts decides from the
 * running version, KTD11); anything else as the library gave it. The header
 * is the one the reader read for this TileJSON (cached). MapLibre merges the
 * source over the TileJSON (load_tilejson.ts: explicit source options take
 * precedence), so an author's `encoding:` still wins. Only core's own
 * handler gets here: a page that registered `pmtiles` itself keeps its
 * handler, without this (host wins).
 *
 * @param protocol - The reader that answered.
 * @param url - The TileJSON request's `pmtiles://` URL.
 * @param reply - The library's reply.
 * @param drawsMlt - Whether the running maplibre-gl draws MLT.
 */
export async function withEncoding<T extends { data?: unknown }>(
  protocol: Protocol,
  url: string,
  reply: T,
  drawsMlt: boolean
): Promise<T> {
  const data = reply.data as Record<string, unknown> | null | undefined;
  if (!drawsMlt || !data || typeof data !== "object") return reply;
  // The library's own key for the archive (`url.substr(10)`).
  const header = await protocol.tiles.get(url.slice("pmtiles://".length))?.getHeader().catch(() => undefined);
  return header?.tileType === MLT ? { ...reply, data: { ...data, encoding: "mlt" } } : reply;
}

/**
 * What core says about an archive's MLT tiles (0.10, U4; design §8.3), shown
 * by the main bundle: with `runtime`, the running maplibre-gl draws no MLT
 * (KTD11, an author hint); without, the tiles failed on 64-bit integer
 * columns, which MapLibre's worker can't pass on (KTD10, the source's notice).
 *
 * @param archive - The archive URL (`pmtiles://` scheme or not).
 * @param runtime - The running maplibre-gl version, when it is below 6.
 */
export function mltNotice(archive: string, runtime?: string): string {
  const file = `\`${displayUrl(archive.replace(/^pmtiles:\/\//i, ""))}\``;
  return (
    (runtime
      ? `${file} holds MLT tiles, which maplibre-gl draws from version 6; this page runs ${runtime}. ` +
        "Use maplibre-gl 6 or later, or build the archive with MVT tiles."
      : `${file} holds MLT tiles with 64-bit integer columns, which this MapLibre version can't draw. ` +
        "Write those columns as doubles or strings, or build MVT tiles.") +
    // The Large data guide's MLT section (core's LARGE_DATA_DOCS.mlt; worded
    // here, in the chunk, as the notice is).
    " More: https://docs.maplibre-yaml.org/guides/large-data/#mlt-tiles"
  );
}
