/**
 * @file Byte sources for footer and header reads (`mlym prepare`; large data round 2 U6, KTD12)
 * @module @maplibre-yaml/cli/lib/file-buffer
 *
 * @description
 * Core's facts readers (`readGeoParquetFacts`, `readFlatGeobufFacts`) take
 * any `AsyncBuffer` — `{ byteLength, slice(start, end?) }`, hyparquet's
 * shape — and read only a file's footer or header through it. Core's index
 * is also built for the browser, so it imports nothing from `node:`; the
 * Node byte sources live here:
 *
 * - {@link openFileBuffer}: a local file, by positional reads on one
 *   `fs.promises` file handle (`FileHandle.read` at a position: no stream to
 *   set up per range, no seek state shared between overlapping reads, and one
 *   descriptor however many ranges are read). Close it ({@link withFileBuffer}
 *   does).
 * - {@link openUrlBuffer}: an http(s) URL, by `Range:` requests — one
 *   `bytes=0-0` to learn the size, then one per slice. A server that ignores
 *   ranges is refused (`no-range`) rather than downloaded whole.
 */

import { open } from 'node:fs/promises';
import type { AsyncBuffer } from '@maplibre-yaml/core';

/** Why a byte source failed: closed, no range support, or an HTTP status. */
export class FileBufferError extends Error {
  constructor(
    message: string,
    readonly code: 'closed' | 'no-range' | 'http' | 'short-read',
    readonly status?: number
  ) {
    super(message);
    this.name = 'FileBufferError';
  }
}

/** A local file's bytes, read a range at a time through one file handle. */
export interface FileBuffer extends AsyncBuffer {
  readonly path: string;
  /** Whether {@link close} has run. */
  readonly closed: boolean;
  slice(start: number, end?: number): Promise<ArrayBuffer>;
  /** Release the file handle. Safe to call twice. */
  close(): Promise<void>;
}

/** `[start, end)` normalized as `ArrayBuffer.prototype.slice` does (negatives from the end, clamped). */
function bounds(size: number, start: number, end: number = size): [number, number] {
  const at = (n: number) => (n < 0 ? Math.max(size + n, 0) : Math.min(n, size));
  const from = at(Math.trunc(start) || 0);
  return [from, Math.max(at(Math.trunc(end)), from)];
}

/**
 * Open a local file as an {@link AsyncBuffer}. The handle stays open until
 * {@link FileBuffer.close}.
 *
 * @throws The file system's error (`ENOENT`, `EACCES`, …); `EISDIR` for a folder.
 */
export async function openFileBuffer(path: string): Promise<FileBuffer> {
  const handle = await open(path, 'r');
  let size: number;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw Object.assign(new Error(`EISDIR: not a file, open '${path}'`), { code: 'EISDIR', path });
    }
    size = stat.size;
  } catch (error) {
    await handle.close();
    throw error;
  }
  let closed = false;
  return {
    path,
    byteLength: size,
    get closed() {
      return closed;
    },
    async slice(start: number, end?: number): Promise<ArrayBuffer> {
      if (closed) throw new FileBufferError(`${path} was already closed`, 'closed');
      const [from, to] = bounds(size, start, end);
      const bytes = new Uint8Array(to - from);
      let done = 0;
      while (done < bytes.length) {
        const { bytesRead } = await handle.read(bytes, done, bytes.length - done, from + done);
        if (bytesRead === 0) break; // the file shrank since it was opened
        done += bytesRead;
      }
      if (done < bytes.length) {
        throw new FileBufferError(`${path} ended at byte ${from + done}, before ${to}: did it change while being read?`, 'short-read');
      }
      return bytes.buffer;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await handle.close();
    },
  };
}

/** Run `work` on a local file's {@link FileBuffer}, closing it afterwards, however `work` ends. */
export async function withFileBuffer<T>(path: string, work: (file: FileBuffer) => Promise<T>): Promise<T> {
  const file = await openFileBuffer(path);
  try {
    return await work(file);
  } finally {
    await file.close();
  }
}

/** Options for {@link openUrlBuffer}. */
export interface UrlBufferOptions {
  /** The fetch to use (default: the global one). */
  fetch?: typeof fetch;
  /** Abort every request (per request, a timeout is the caller's `AbortSignal.timeout`). */
  signal?: AbortSignal;
}

/**
 * An http(s) URL as an {@link AsyncBuffer}: one `Range: bytes=0-0` request
 * learns the file's size (`Content-Range`), then each slice is one range
 * request. `Accept-Encoding: identity`, so a range is the file's bytes, not a
 * compressed copy's.
 *
 * @throws {@link FileBufferError}: `http` (with the status) for an error
 *   status, `no-range` for a server that ignores `Range:` or hides the size;
 *   what `fetch` threw for a network failure.
 */
export async function openUrlBuffer(url: string, options: UrlBufferOptions = {}): Promise<AsyncBuffer> {
  const get = options.fetch ?? fetch;
  const request = async (start: number, end: number): Promise<Response> => {
    const response = await get(url, {
      headers: { Range: `bytes=${start}-${end - 1}`, 'Accept-Encoding': 'identity' },
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new FileBufferError(`HTTP ${response.status}: ${response.statusText} for ${url}`, 'http', response.status);
    }
    if (response.status !== 206) {
      void response.body?.cancel().catch(() => undefined);
      throw new FileBufferError(`${url}: the server ignores range requests, so only the whole file could be read`, 'no-range');
    }
    return response;
  };
  const first = await request(0, 1);
  const total = /\/(\d+)\s*$/.exec(first.headers.get('content-range') ?? '')?.[1];
  void first.body?.cancel().catch(() => undefined);
  if (total === undefined) {
    throw new FileBufferError(`${url}: the server doesn't say the file's size (no Content-Range total)`, 'no-range');
  }
  const size = Number(total);
  return {
    byteLength: size,
    async slice(start: number, end?: number): Promise<ArrayBuffer> {
      const [from, to] = bounds(size, start, end);
      if (to === from) return new ArrayBuffer(0);
      const bytes = await (await request(from, to)).arrayBuffer();
      if (bytes.byteLength !== to - from) {
        throw new FileBufferError(`${url}: asked for ${to - from} bytes at ${from}, got ${bytes.byteLength}`, 'short-read');
      }
      return bytes;
    },
  };
}
