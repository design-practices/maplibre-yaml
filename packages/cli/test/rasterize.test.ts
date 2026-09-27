/**
 * @file Sprite rasterization determinism (U4, KTD3)
 *
 * @description
 * PNG bytes are libvips/platform-fragile, so determinism is asserted on the
 * decoded RGBA pixels and the (byte-exact) index JSON — with sharp pinned
 * exact in this package to keep the encoder stable within a lockfile.
 */

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { hatchTileSvg, pinSvg } from '@maplibre-yaml/core';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import {
  rasterizeSpriteFiles,
  resolveImageRefs,
  IMAGE_MAX_CSS_PX,
  type ResolvedImage,
} from '../src/lib/rasterize.js';
import { spriteAssetArgsError } from '../src/commands/emit.js';

const decode = (png: Buffer) =>
  sharp(png).raw().toBuffer({ resolveWithObject: true });

describe('rasterizeSpriteFiles', () => {
  it('produces the standard four-file set with pixel-deterministic sheets', async () => {
    const assets = [
      hatchTileSvg({ angle: 45, spacing: 8 }),
      hatchTileSvg({ angle: 30, spacing: 6, color: '#7b2cbf' }),
    ];

    const first = await rasterizeSpriteFiles(assets);
    const second = await rasterizeSpriteFiles(assets);

    expect(first.map((f) => f.filename).sort()).toEqual([
      'mlym.json',
      'mlym.png',
      'mlym@2x.json',
      'mlym@2x.png',
    ]);

    // Index JSON is byte-identical across runs.
    const indexA = first.find((f) => f.filename === 'mlym.json')!.data;
    const indexB = second.find((f) => f.filename === 'mlym.json')!.data;
    expect(indexA.equals(indexB)).toBe(true);

    // Sheets are pixel-identical across runs (decoded RGBA, not PNG bytes).
    for (const name of ['mlym.png', 'mlym@2x.png']) {
      const a = await decode(first.find((f) => f.filename === name)!.data);
      const b = await decode(second.find((f) => f.filename === name)!.data);
      expect(a.info).toEqual(b.info);
      expect(a.data.equals(b.data)).toBe(true);
    }
  });

  it('sheet geometry matches the index and the @2x pair doubles it', async () => {
    const assets = [hatchTileSvg({ size: 32 })];
    const files = await rasterizeSpriteFiles(assets);

    const sheet1x = await decode(files.find((f) => f.filename === 'mlym.png')!.data);
    expect(sheet1x.info.width).toBe(32);
    expect(sheet1x.info.height).toBe(32);

    const sheet2x = await decode(files.find((f) => f.filename === 'mlym@2x.png')!.data);
    expect(sheet2x.info.width).toBe(64);

    const index = JSON.parse(
      files.find((f) => f.filename === 'mlym@2x.json')!.data.toString('utf-8')
    );
    const entry = Object.values(index)[0] as { width: number; pixelRatio: number };
    expect(entry.width).toBe(64);
    expect(entry.pixelRatio).toBe(2);
  });

  it('the hatch tile tiles seamlessly: opposite edges carry the same stroke pattern', async () => {
    // The lattice snap makes the stroke family periodic over the tile. If it
    // regresses (the pre-fix default jogged ~2.6px at every boundary), the
    // left/right and top/bottom edge alpha profiles diverge.
    const files = await rasterizeSpriteFiles([
      hatchTileSvg({ angle: 45, spacing: 8, strokeWidth: 2, size: 32 }),
    ]);
    const { data, info } = await decode(files.find((f) => f.filename === 'mlym.png')!.data);
    const alpha = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3]!;

    // A stroke crossing at row y on the left edge must reappear at the right
    // edge's continuation (x = width-1 is the same lattice line one period
    // over). Compare binarized profiles with 1px tolerance for antialiasing.
    const profile = (edge: 'left' | 'right' | 'top' | 'bottom') => {
      const out: number[] = [];
      for (let i = 0; i < 32; i++) {
        const value =
          edge === 'left' ? alpha(0, i)
          : edge === 'right' ? alpha(31, i)
          : edge === 'top' ? alpha(i, 0)
          : alpha(i, 31);
        out.push(value > 64 ? 1 : 0);
      }
      return out;
    };
    const matches = (a: number[], b: number[]) =>
      a.filter((v, i) => v === (b[i - 1] ?? 0) || v === b[i] || v === (b[i + 1] ?? 0)).length;

    expect(matches(profile('left'), profile('right'))).toBeGreaterThanOrEqual(30);
    expect(matches(profile('top'), profile('bottom'))).toBeGreaterThanOrEqual(30);
  });

  it('the hatch tile actually contains ink (strokes rasterized, not a blank sheet)', async () => {
    const files = await rasterizeSpriteFiles([hatchTileSvg({ color: '#000000' })]);
    const { data } = await decode(files.find((f) => f.filename === 'mlym.png')!.data);
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) opaque++;
    expect(opaque).toBeGreaterThan(50);
    // …and it is not solid ink either — a pattern needs both.
    expect(opaque).toBeLessThan(data.length / 4);
  });
});

describe('resolveImageRefs + mixed-sheet rasterization (U6)', () => {
  /** A tiny deterministic PNG (4x4 opaque red) minted through sharp. */
  const redPng = () =>
    sharp({
      create: { width: 4, height: 4, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer();

  const serve = async (): Promise<{ server: Server; url: string }> => {
    const png = await redPng();
    const server = createServer((req, res) => {
      if (req.url === '/icon.png') {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(png);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as { port: number };
    return { server, url: `http://127.0.0.1:${address.port}` };
  };

  it('fetches, measures, and divides by the declared pixelRatio', async () => {
    const { server, url } = await serve();
    try {
      const [plain, dense] = await resolveImageRefs([
        { name: 'plain', url: `${url}/icon.png` },
        { name: 'dense', url: `${url}/icon.png`, pixelRatio: 2, sdf: true },
      ]);
      expect(plain).toMatchObject({ width: 4, height: 4 });
      expect(dense).toMatchObject({ width: 2, height: 2, sdf: true });
    } finally {
      server.close();
    }
  });

  it('a hanging server times out with a clear error instead of hanging emit', async () => {
    const server = createServer(() => {
      /* never respond */
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as { port: number };
    try {
      await expect(
        resolveImageRefs(
          [{ name: 'tarpit', url: `http://127.0.0.1:${port}/never.png` }],
          200,
        ),
      ).rejects.toThrow(/timed out after 200ms/);
    } finally {
      server.close();
      server.closeAllConnections?.();
    }
  });

  it('an image over the CSS-pixel ceiling is refused loudly', async () => {
    const huge = await sharp({
      create: {
        width: IMAGE_MAX_CSS_PX + 8,
        height: 4,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(huge);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as { port: number };
    try {
      await expect(
        resolveImageRefs([{ name: 'huge', url: `http://127.0.0.1:${port}/huge.png` }]),
      ).rejects.toThrow(/exceeds the 1024px sprite-entry ceiling/);
    } finally {
      server.close();
    }
  });

  it('a fetch failure or relative URL throws — never a silent hole in the sprite', async () => {
    const { server, url } = await serve();
    try {
      await expect(
        resolveImageRefs([{ name: 'gone', url: `${url}/missing.png` }])
      ).rejects.toThrow(/404/);
    } finally {
      server.close();
    }
    await expect(
      resolveImageRefs([{ name: 'rel', url: './local.png' }])
    ).rejects.toThrow(/absolute http/);
  });

  it('fetched images share the sheet with generated assets, sdf carried into the index', async () => {
    const image: ResolvedImage = {
      name: 'fetched-icon',
      url: 'https://x.example/icon.png',
      data: await redPng(),
      width: 4,
      height: 4,
      sdf: true,
    };
    const files = await rasterizeSpriteFiles([pinSvg()], [image]);
    const index = JSON.parse(files.find((f) => f.filename === 'mlym.json')!.data.toString());
    expect(Object.keys(index)).toHaveLength(2);
    expect(index['fetched-icon']).toMatchObject({ width: 4, height: 4, sdf: true });
    expect(index[pinSvg().name]).toBeDefined();

    // The fetched pixels actually landed on the sheet: the entry's region is red.
    const sheet = files.find((f) => f.filename === 'mlym.png')!.data;
    const { data, info } = await decode(sheet);
    const { x, y } = index['fetched-icon'];
    const px = (y * info.width + x) * info.channels;
    expect([data[px], data[px + 1], data[px + 2]]).toEqual([255, 0, 0]);

    // The @2x pair carries the raster too: doubled entry, red pixels.
    const index2x = JSON.parse(
      files.find((f) => f.filename === 'mlym@2x.json')!.data.toString(),
    );
    expect(index2x['fetched-icon']).toMatchObject({
      width: 8,
      height: 8,
      pixelRatio: 2,
      sdf: true,
    });
    const sheet2x = files.find((f) => f.filename === 'mlym@2x.png')!.data;
    const d2 = await decode(sheet2x);
    const p2 =
      (index2x['fetched-icon'].y * d2.info.width + index2x['fetched-icon'].x) *
      d2.info.channels;
    expect([d2.data[p2], d2.data[p2 + 1], d2.data[p2 + 2]]).toEqual([255, 0, 0]);
  });
});

describe('spriteAssetArgsError (the emit argument contract for assets)', () => {
  const asset = hatchTileSvg();

  it('asset-free emits pass with any args', () => {
    expect(spriteAssetArgsError(undefined, undefined, undefined)).toBeNull();
    expect(spriteAssetArgsError([], undefined, undefined)).toBeNull();
  });

  it('assets without --out is an error (stdout would ship a broken style)', () => {
    expect(spriteAssetArgsError([asset], undefined, 'https://x.example')).toMatch(/--out/);
  });

  it('assets without --sprite-base is an error (MapLibre rejects relative sprite URLs)', () => {
    expect(spriteAssetArgsError([asset], 'dist/style.json', undefined)).toMatch(/--sprite-base/);
  });

  it('assets with both args pass', () => {
    expect(spriteAssetArgsError([asset], 'dist/style.json', 'https://x.example')).toBeNull();
  });

  it('image refs alone trigger the same contract (U6)', () => {
    const ref = { name: 'poi', url: 'https://x.example/poi.png' };
    expect(spriteAssetArgsError(undefined, undefined, undefined, [ref])).toMatch(/--out/);
    expect(spriteAssetArgsError(undefined, 'dist/style.json', undefined, [ref])).toMatch(
      /--sprite-base/,
    );
    expect(
      spriteAssetArgsError(undefined, 'dist/style.json', 'https://x.example', [ref]),
    ).toBeNull();
  });
});
