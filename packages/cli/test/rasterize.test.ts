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
import { hatchTileSvg } from '@maplibre-yaml/core';
import { rasterizeSpriteFiles } from '../src/lib/rasterize.js';
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
});
