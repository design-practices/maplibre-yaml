/**
 * @file What the cloud-native readers need from HTTP, written once (0.9, ml-cnv)
 * @module @maplibre-yaml/core/formats/http
 *
 * @description
 * Static hosts disagree on two details of range requests, and a reader that
 * assumes either one misreads a perfectly good file:
 *
 * - **An oversized suffix range.** `Range: bytes=-524288` on a 28 KB file
 *   should return the whole file (RFC 9110 §14.1.3). Fastly — GitHub Pages,
 *   raw.githubusercontent.com, jsDelivr's Fastly leg — answers
 *   `416 Range Not Satisfiable` with `Content-Range: bytes *\/28438` instead.
 *   Nginx, S3, R2, Netlify and Cloudflare clamp. A reader that treats the 416
 *   as an error reports a good small file as missing.
 * - **A hidden `Content-Range`.** A cross-origin response exposes only the
 *   CORS-safelisted headers unless the host sends
 *   `Access-Control-Expose-Headers: Content-Range`. GitHub Pages and
 *   raw.githubusercontent.com don't, so a page on another site sees a 206
 *   with no `Content-Range`: no file size, and no offset for a suffix read.
 *   `Content-Length` is safelisted and always readable.
 *
 * {@link fetchTail} reads a file's last bytes under both; the other helpers
 * are what every reader shares: the GeoJSON fetcher's HTTP error shape and a
 * body read that stops at a size limit even when the server sent no
 * `Content-Length`.
 */

/** The GeoJSON fetcher's HTTP error shape, so the notice treats every format alike. */
export function httpError(response: Response, url: string): Error {
  return Object.assign(new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`), {
    url,
    status: response.status,
  });
}

/** Throw away a response body that won't be read. */
export function discardBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // Already consumed or locked: nothing to release.
  }
}

/** `Content-Length` as a number, when the server sent a usable one. */
export function contentLengthOf(response: Response): number | undefined {
  const value = response.headers.get("content-length");
  if (value === null || value.trim() === "") return undefined;
  const length = Number(value);
  return Number.isFinite(length) && length >= 0 ? length : undefined;
}

/** A `Content-Range: bytes a-b/size` header, when this page may read it. */
export function contentRangeOf(response: Response): { start: number; end: number; size?: number } | undefined {
  const m = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(response.headers.get("content-range") ?? "");
  if (!m) return undefined;
  return { start: Number(m[1]), end: Number(m[2]), ...(m[3] !== "*" ? { size: Number(m[3]) } : {}) };
}

/** Raised by {@link readCapped} once a body passes its limit. */
export class BodyTooLarge extends Error {
  /**
   * Set by {@link fetchTail}: whether the server serves range requests (false:
   * it sent the whole file because it ignores `Range:`).
   */
  ranges?: boolean;

  /** @param size - The bytes known so far: `Content-Length`, or what had arrived. */
  constructor(readonly size: number) {
    super(`response body over the size limit (${size} bytes so far)`);
    this.name = "BodyTooLarge";
  }
}

/**
 * Read a whole response body, stopping at `max` bytes. `Content-Length`
 * decides before anything is read when the server sent one; without it (a
 * chunked or compressed response) the bytes are counted as they stream, and
 * the download is cancelled the moment the count passes `max`.
 *
 * @throws {BodyTooLarge} over `max`.
 */
export async function readCapped(response: Response, max?: number): Promise<ArrayBuffer> {
  if (max === undefined) return response.arrayBuffer();
  const length = contentLengthOf(response);
  if (length !== undefined && length > max) {
    discardBody(response);
    throw new BodyTooLarge(length);
  }
  const body = response.body;
  if (!body) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > max) throw new BodyTooLarge(bytes.byteLength);
    return bytes;
  }
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      void reader.cancel().catch(() => undefined);
      throw new BodyTooLarge(total);
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out.buffer;
}

/** Options for {@link fetchTail}. */
export interface TailOptions {
  signal?: AbortSignal;
  /** The largest whole file accepted when the whole file has to be read. */
  maxWholeBytes?: number;
}

/** A file's last bytes, as {@link fetchTail} read them. */
export interface Tail {
  /** Where `bytes` starts in the file (0 when they are the whole file). */
  start: number;
  bytes: ArrayBuffer;
  /** The file's size. */
  size: number;
  /**
   * Whether the server serves range requests. False only for a server that
   * ignored `Range:` and sent the whole file (`python -m http.server`).
   */
  ranges: boolean;
}

/** The file's size from a `HEAD` (`Content-Length` is readable cross-origin). */
async function headSize(url: string, signal?: AbortSignal): Promise<number | undefined> {
  try {
    const response = await fetch(url, { method: "HEAD", ...(signal ? { signal } : {}) });
    return response.ok ? contentLengthOf(response) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read the last `length` bytes of a file — all of it, when it is smaller —
 * with one suffix-range request where the host allows, and the size with
 * them.
 *
 * - **206 with `Content-Range`**: the bytes and the size, from one request.
 * - **416** (Fastly, for a file shorter than `length`): the file is small —
 *   it is read whole with a plain `GET`.
 * - **206 whose body isn't the length its `Content-Range` says** (a range
 *   applied to a compressed copy, then decoded by the browser — jsDelivr's
 *   Cloudflare leg): the whole file when the range covered all of it, else
 *   the file is read whole.
 * - **206 without a readable `Content-Range`** (a cross-origin host that
 *   doesn't expose it): fewer bytes than asked for are the whole file;
 *   exactly `length` bytes are the end of a bigger one, whose size a `HEAD`
 *   gives — and when even that fails, the file is read whole.
 * - **200**: the server ignored `Range:` and sent the whole file
 *   (`ranges: false`).
 * - **A range reply that can't be read at all** (jsDelivr's Cloudflare leg
 *   compresses it, and the browser can't decode a part): the file is read
 *   whole, when a plain `GET` of it works.
 *
 * A whole-file read stops at `maxWholeBytes` (with {@link BodyTooLarge}),
 * whether or not the server sent `Content-Length`.
 *
 * @throws The `HTTP <status>` shape ({@link httpError}) for an error status;
 *   whatever `fetch` threw for a request that never completed;
 *   {@link BodyTooLarge}.
 */
export async function fetchTail(url: string, length: number, options: TailOptions = {}): Promise<Tail> {
  const { signal, maxWholeBytes } = options;
  const init = signal ? { signal } : {};
  /** The whole body, the over-the-limit error saying whether ranges work. */
  const body = async (response: Response, ranges: boolean): Promise<Tail> => {
    try {
      const bytes = await readCapped(response, maxWholeBytes);
      return { start: 0, bytes, size: bytes.byteLength, ranges };
    } catch (error) {
      if (error instanceof BodyTooLarge) error.ranges = ranges;
      throw error;
    }
  };
  const whole = async (): Promise<Tail> => {
    const response = await fetch(url, init);
    if (!response.ok) {
      discardBody(response);
      throw httpError(response, url);
    }
    return body(response, true);
  };

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { Range: `bytes=-${length}` } });
  } catch (error) {
    // A reply that couldn't be read — a host that compresses the parts of
    // files it sends — while the whole file comes through: read it whole.
    if (!(await rangeRepliesUnreadable(url))) throw error;
    return whole();
  }
  if (response.status === 416) {
    // Fastly's answer to a suffix longer than the file: the file is short.
    discardBody(response);
    return whole();
  }
  if (!response.ok) {
    discardBody(response);
    throw httpError(response, url);
  }
  if (response.status !== 206) {
    // The server ignored `Range:` and is sending the whole file.
    return body(response, false);
  }

  const range = contentRangeOf(response);
  const bytes = await response.arrayBuffer();
  if (range) {
    if (bytes.byteLength === range.end - range.start + 1) {
      return { start: range.start, bytes, size: range.size ?? range.start + bytes.byteLength, ranges: true };
    }
    // The body isn't the length the range says: the host applied the range
    // to a compressed copy and the browser decoded it (jsDelivr's Cloudflare
    // leg answers with `Content-Encoding: br` 206s). A range that covered the
    // whole compressed copy decodes to the whole file; anything else can't
    // be placed, so read the file whole.
    if (range.start === 0 && range.size !== undefined && range.end + 1 === range.size) {
      return { start: 0, bytes, size: bytes.byteLength, ranges: true };
    }
    return whole();
  }
  // `Content-Range` hidden from this page (not in Access-Control-Expose-Headers).
  if (bytes.byteLength < length) return { start: 0, bytes, size: bytes.byteLength, ranges: true };
  const size = await headSize(url, signal);
  if (size !== undefined && size >= bytes.byteLength) {
    return { start: size - bytes.byteLength, bytes, size, ranges: true };
  }
  return whole();
}

/**
 * Whether a range response is compressed (`Content-Encoding` other than
 * identity): its bytes are part of a compressed copy, which can't be decoded
 * on its own. jsDelivr's Cloudflare leg answers this way; the header is
 * readable cross-origin only where the host exposes it (jsDelivr does).
 */
export function isEncodedRange(response: Response): boolean {
  if (response.status !== 206) return false;
  const encoding = response.headers.get("content-encoding")?.trim().toLowerCase();
  return Boolean(encoding && encoding !== "identity");
}

/**
 * Whether a host's replies to range requests are cut from a compressed copy
 * of the file — jsDelivr's Cloudflare leg serves its files brotli-compressed
 * and answers a range from the compressed bytes (with or without saying so),
 * so a part is either undecodable or not the file's bytes at all. Asked with
 * a plain `HEAD`, whose `Content-Encoding` says the file is served compressed.
 * Only for a reader whose range reads already failed: `false` when it can't
 * tell.
 */
export async function rangeRepliesUnreadable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    const encoding = response.headers.get("content-encoding")?.trim().toLowerCase();
    return response.ok && Boolean(encoding && encoding !== "identity");
  } catch {
    return false;
  }
}

/**
 * The whole file, with one plain `GET` (the browser decodes a compressed
 * one), stopping at `maxWholeBytes`.
 *
 * @throws The `HTTP <status>` shape; whatever `fetch` threw; {@link BodyTooLarge}.
 */
export async function fetchWhole(url: string, options: TailOptions = {}): Promise<Tail> {
  const response = await fetch(url, options.signal ? { signal: options.signal } : {});
  if (!response.ok) {
    discardBody(response);
    throw httpError(response, url);
  }
  try {
    const bytes = await readCapped(response, options.maxWholeBytes);
    return { start: 0, bytes, size: bytes.byteLength, ranges: true };
  } catch (error) {
    if (error instanceof BodyTooLarge) error.ranges = true;
    throw error;
  }
}
