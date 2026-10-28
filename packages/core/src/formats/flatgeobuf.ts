/**
 * @file FlatGeobuf, the main bundle's half: the whole-file `GET` (0.9, ml-cnv.3; bundle headroom U5)
 * @module @maplibre-yaml/core/formats/flatgeobuf
 *
 * @description
 * Reading a FlatGeobuf file — the adapter, the size guards and the data
 * provider — is the `flatgeobuf` on-demand chunk (formats/lib/flatgeobuf.ts,
 * `chunks/flatgeobuf.js`), with the library it calls. What stays in the main
 * bundle is the request a whole-file read starts with: the page asks for the
 * file while the chunk downloads (the two overlap, as they did when the
 * adapter lived here), then hands the opened response to the chunk.
 *
 * A failure is thrown as the chunk's own reads throw it: an HTTP error status
 * in the shape the GeoJSON fetcher uses (`HTTP 404: Not Found for <url>`),
 * so the notice words a missing `.fgb` exactly like a missing `.geojson`, and
 * an unreachable file as a `cors` {@link FormatError}.
 */

import { FormatError, isAbortError } from "./errors";
import { httpError } from "./http";

/** A response opened for a whole-file read, before its body is decoded. */
export interface OpenedFile {
  response: Response;
  /** `Content-Length`, when the server sent one. */
  size?: number;
}

/**
 * Start a whole-file read: one `GET`, headers only. The reader decides from
 * the size whether to decode it (`decodeStream` in the chunk) or switch to
 * reading part of the file.
 */
export async function openWhole(url: string, signal?: AbortSignal): Promise<OpenedFile> {
  let response: Response;
  try {
    response = await fetch(url, signal ? { signal } : {});
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new FormatError({ code: "cors", format: "flatgeobuf", url });
  }
  if (!response.ok) throw httpError(response, url);
  // A compressed response's Content-Length counts the compressed bytes, not
  // what is decoded (ml-37r.16): then the guard counts the bytes as they
  // stream, decompressed, instead.
  const encoding = response.headers.get("content-encoding");
  const length = encoding && encoding !== "identity" ? 0 : Number(response.headers.get("content-length"));
  return { response, ...(Number.isFinite(length) && length > 0 ? { size: length } : {}) };
}

/** Throw away a response body that won't be read. */
export function discard(opened: OpenedFile): void {
  try {
    void opened.response.body?.cancel().catch(() => undefined);
  } catch {
    // Already consumed or locked: nothing to release.
  }
}
