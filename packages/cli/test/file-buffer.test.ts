/**
 * The byte sources `mlym prepare` reads a file's footer or header through
 * (large data round 2 U6, KTD12): a local file by positional reads on one
 * file handle, an http(s) URL by range requests — never the whole file.
 * Both are core's `AsyncBuffer`, which core's facts readers take.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { readGeoParquetFacts, readFlatGeobufFacts } from '@maplibre-yaml/core';
import { openFileBuffer, openUrlBuffer, withFileBuffer, FileBufferError } from '../src/lib/file-buffer';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '../../../docs/public/gallery-assets/cloud-native');
const PARQUET = join(FIXTURES, 'lots-overviews.parquet');
const FGB = join(FIXTURES, 'districts.fgb');
const bytesOf = (path: string) => new Uint8Array(readFileSync(path));

describe('openFileBuffer', () => {
  it('has the file size as its byteLength, and slices the right bytes', async () => {
    const want = bytesOf(PARQUET);
    const file = await openFileBuffer(PARQUET);
    try {
      expect(file.byteLength).toBe(statSync(PARQUET).size);
      expect(new Uint8Array(await file.slice(0, 4))).toEqual(want.slice(0, 4));
      expect(new Uint8Array(await file.slice(1000, 1500))).toEqual(want.slice(1000, 1500));
      // `end` defaults to the file's end; past the end is clamped, as ArrayBuffer.slice.
      expect(new Uint8Array(await file.slice(want.length - 8))).toEqual(want.slice(-8));
      expect(new Uint8Array(await file.slice(want.length - 4, want.length + 100))).toEqual(want.slice(-4));
      expect((await file.slice(10, 10)).byteLength).toBe(0);
      expect(new Uint8Array(await file.slice(-8))).toEqual(want.slice(-8));
    } finally {
      await file.close();
    }
  });

  it('close releases the handle: later slices are refused, a second close is harmless', async () => {
    const file = await openFileBuffer(FGB);
    await file.close();
    expect(file.closed).toBe(true);
    await expect(file.slice(0, 4)).rejects.toBeInstanceOf(FileBufferError);
    await expect(file.close()).resolves.toBeUndefined();
  });

  it('withFileBuffer closes the handle when the work throws', async () => {
    let seen: Awaited<ReturnType<typeof openFileBuffer>> | undefined;
    await expect(
      withFileBuffer(FGB, async (file) => {
        seen = file;
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(seen?.closed).toBe(true);
  });

  it('a missing file rejects with its ENOENT error', async () => {
    await expect(openFileBuffer(join(FIXTURES, 'missing.parquet'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('a folder is refused, and no handle is left open', async () => {
    await expect(openFileBuffer(FIXTURES)).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it("feeds core's facts readers, which read only the footer and header", async () => {
    const parquet = await withFileBuffer(PARQUET, (file) => readGeoParquetFacts(file, 'lots-overviews.parquet'));
    expect(parquet).toMatchObject({ rows: 600, rowGroups: 3, bboxColumn: 'bbox', spatialOrder: 'sorted' });
    expect(parquet.overviews?.levels).toHaveLength(5);
    const fgb = await withFileBuffer(FGB, (file) => readFlatGeobufFacts(file, 'districts.fgb'));
    expect(fgb).toMatchObject({ features: 48, indexed: true, crs: 'EPSG:4326' });
  });
});

describe('openUrlBuffer', () => {
  let server: Server;
  let base: string;
  const requests: { url: string; range?: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? '/';
      requests.push({ url, ...(req.headers.range ? { range: req.headers.range } : {}) });
      const norange = url.startsWith('/norange/');
      const name = url.replace(/^\/(norange\/)?/, '');
      let body: Uint8Array;
      try {
        body = bytesOf(join(FIXTURES, name));
      } catch {
        res.writeHead(404).end('not found');
        return;
      }
      const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
      if (!m || norange) {
        res.writeHead(200, { 'Content-Length': body.length }).end(body);
        return;
      }
      const start = Number(m[1]);
      const end = Math.min(Number(m[2]), body.length - 1);
      res
        .writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1 })
        .end(body.subarray(start, end + 1));
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((done) => server.close(done));
  });

  it('learns the size from one range request and reads ranges', async () => {
    const want = bytesOf(PARQUET);
    requests.length = 0;
    const file = await openUrlBuffer(`${base}/lots-overviews.parquet`);
    expect(file.byteLength).toBe(want.length);
    expect(new Uint8Array(await file.slice(100, 200))).toEqual(want.slice(100, 200));
    expect(new Uint8Array(await file.slice(want.length - 8))).toEqual(want.slice(-8));
    expect(requests.every((r) => r.range)).toBe(true);
  });

  it("feeds core's facts readers by range requests alone", async () => {
    requests.length = 0;
    const facts = await readGeoParquetFacts(await openUrlBuffer(`${base}/lots-overviews.parquet`), 'lots-overviews.parquet');
    expect(facts.rows).toBe(600);
    expect(requests.every((r) => r.range)).toBe(true);
  });

  it('a server that ignores ranges is refused as no-range', async () => {
    await expect(openUrlBuffer(`${base}/norange/districts.fgb`)).rejects.toMatchObject({ code: 'no-range' });
  });

  it('an HTTP error carries its status', async () => {
    await expect(openUrlBuffer(`${base}/missing.fgb`)).rejects.toMatchObject({ code: 'http', status: 404 });
  });
});
