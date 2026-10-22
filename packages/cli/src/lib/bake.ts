/**
 * @file Texture bakes for the Mapzen-classic static presets (U10′)
 * @module @maplibre-yaml/cli/lib/bake
 *
 * @description
 * The classic presets are plain style spec: every look they need is a
 * `*-pattern` image. These functions derive those images reproducibly —
 * the crosshatch set from Tangram's own MIT-licensed source textures
 * (vendored, unmodified, in `assets/tangram/`), the blueprint grid from
 * scratch. sharp lives in the CLI for exactly this kind of work (KTD3), so
 * `@maplibre-yaml/core` stays dependency-free.
 *
 * Tangram draws ground and water UNLIT — earth and landuse are a
 * tile-repeated hatch texture mixed ink→paper, water is a crumpled-paper
 * normal map under the style's fixed lights — so each bakes to a plain
 * image that a `*-pattern` reproduces.
 *
 * Pre-filtered, not verbatim: Tangram mipmapped its hatch textures, MapLibre
 * samples patterns with NO mipmaps. A pitched map draws the far ground
 * minified, and a hatch with detail finer than that minification aliases —
 * the strokes break up and shimmer as the map moves. So the hatches are
 * baked at twice the period (2x upscale), with strokes softened by a small
 * Gaussian and their ink↔paper contrast eased to 85 %, then posterized to
 * 32 tones in a palette PNG. The image itself carries no detail finer than
 * the worst minification it will see.
 *
 * Buildings are the lit part of the look. The crosshatch document draws them
 * as plain lit extrusions: a pattern on a wall is sampled edge-on, which is
 * where an un-mipmapped texture shimmers worst, and tonal wall hatching is
 * the runtime effect's job. `crosshatch-walls` still bakes a wall hatch for
 * a document that wants one statically, pre-filtered along the stroke.
 */

import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** One baked file, ready to write into the preset's image directory. */
export interface BakedFile {
  filename: string;
  data: Buffer;
}

/** A named bake: what it produces, and how. */
export interface BakePreset {
  description: string;
  outputs: readonly string[];
  bake: (assetsDir: string) => Promise<BakedFile[]>;
}

/**
 * Locate the vendored Tangram textures. The source tree keeps them at
 * `packages/cli/assets/tangram`; the bundled CLI (`dist/cli.js`) and the
 * unbundled sources (`src/lib/bake.ts`, under vitest) sit at different
 * depths, so walk up until the directory appears.
 */
export function defaultAssetsDir(from: string = fileURLToPath(import.meta.url)): string {
  let dir = dirname(from);
  for (let i = 0; i < 4; i++) {
    const candidate = join(dir, 'assets', 'tangram');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error('Could not locate the vendored Tangram textures (assets/tangram).');
}

/** Tangram's crosshatch palette (tangram-sandbox styles/crosshatch.yaml). */
export const INK = [77, 77, 78] as const; // vec3(0.302, 0.302, 0.306)
export const PAPER = [249, 243, 227] as const; // vec3(0.976, 0.953, 0.890)

/** How a hatch is pre-filtered for un-mipmapped sampling. */
export interface HatchFilter {
  /** Enlarge the source this many times: the hatch period grows with it. */
  upscale: number;
  /**
   * Gaussian sigma in OUTPUT pixels, rounding the stroke profile (the
   * harmonics that alias first). `[x, y]` blurs the axes differently.
   */
  sigma: number | readonly [number, number];
  /** Ink↔paper amplitude kept about the mean coverage (1 = full ink). */
  contrast: number;
  /** Posterize coverage to this many tones (0 = no posterize). */
  levels: number;
}

/** The ground hatches (earth, landuse): 2x period, soft strokes, 85 % ink, 32 tones. */
export const GROUND_FILTER: HatchFilter = { upscale: 2, sigma: 1.2, contrast: 0.85, levels: 32 };
/** The wall hatch: 2x period, smoothed ALONG the stroke so walls seen edge-on stay steady. */
export const WALL_FILTER: HatchFilter = { upscale: 2, sigma: [12, 2], contrast: 0.9, levels: 32 };

/**
 * Separable 1-D Gaussian along x (`horizontal`) or y over a square
 * single-channel buffer, edges clamped. The caller tiles 3x3 first, so the
 * clamp never reaches the centre tile it keeps.
 */
function gaussian(buf: Buffer, n: number, sigma: number, horizontal: boolean): Buffer {
  if (!(sigma > 0)) return buf;
  const r = Math.ceil(sigma * 3);
  const k: number[] = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(v);
    sum += v;
  }
  const out = Buffer.alloc(buf.length);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) {
        const xx = horizontal ? Math.min(n - 1, Math.max(0, x + i)) : x;
        const yy = horizontal ? y : Math.min(n - 1, Math.max(0, y + i));
        a += k[i + r]! * buf[yy * n + xx]!;
      }
      out[y * n + x] = Math.round(a / sum);
    }
  }
  return out;
}

/**
 * A pre-filtered ink-on-paper hatch. The source texture's alpha is stroke
 * coverage; it is upscaled and blurred seamlessly (tiled 3x3, filtered, the
 * centre cropped), its contrast eased about the mean coverage, posterized,
 * then mixed PAPER (no stroke) → INK (full stroke) into an opaque palette
 * PNG. Deterministic: same source, same filter, same pixels.
 */
export async function prefilteredHatch(src: string, filter: HatchFilter): Promise<Buffer> {
  const { data, info } = await sharp(src)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== info.height) throw new Error(`${src}: hatch source must be square`);
  const size = info.width;
  const coverage = Buffer.alloc(size * size);
  for (let i = 0; i < coverage.length; i++) coverage[i] = data[i * 4 + 3]!;

  // Tile 3x3 so resize and blur wrap around the tile's edges.
  const big = Buffer.alloc(size * 3 * size * 3);
  for (let ty = 0; ty < 3; ty++) {
    for (let y = 0; y < size; y++) {
      for (let tx = 0; tx < 3; tx++) {
        coverage.copy(big, (ty * size + y) * size * 3 + tx * size, y * size, (y + 1) * size);
      }
    }
  }
  const S = size * filter.upscale;
  let img = sharp(big, { raw: { width: size * 3, height: size * 3, channels: 1 } });
  if (filter.upscale !== 1) {
    img = img.resize(S * 3, S * 3, { kernel: filter.upscale > 1 ? 'lanczos3' : 'mitchell' });
  }
  let buf: Buffer = await img.extractChannel(0).raw().toBuffer();
  if (buf.length !== S * 3 * S * 3) throw new Error(`${src}: unexpected resize output`);
  const [sx, sy] = typeof filter.sigma === 'number' ? [filter.sigma, filter.sigma] : filter.sigma;
  buf = gaussian(gaussian(buf, S * 3, sx, true), S * 3, sy, false);
  const tile = await sharp(buf, { raw: { width: S * 3, height: S * 3, channels: 1 } })
    .extract({ left: S, top: S, width: S, height: S })
    .extractChannel(0)
    .raw()
    .toBuffer();

  let mean = 0;
  for (const v of tile) mean += v / 255;
  mean /= tile.length;
  const px = Buffer.alloc(S * S * 3);
  for (let i = 0; i < S * S; i++) {
    let cov = Math.min(1, Math.max(0, mean + (tile[i]! / 255 - mean) * filter.contrast));
    if (filter.levels > 1) cov = Math.round(cov * (filter.levels - 1)) / (filter.levels - 1);
    for (let c = 0; c < 3; c++) px[i * 3 + c] = Math.round(PAPER[c]! * (1 - cov) + INK[c]! * cov);
  }
  return sharp(px, { raw: { width: S, height: S, channels: 3 } })
    .png({ compressionLevel: 9, palette: true, colours: 256, dither: 0 })
    .toBuffer();
}

/**
 * Water: Tangram lights normal-0031 on #343434 with a directional light
 * (default direction [0.2, 0.7, -0.5], diffuse 1, ambient .3) plus a point
 * light south of and above centre (diffuse .5, ambient .3). The lights never
 * move, so the lit result is a fixed image.
 */
export async function litWater(src: string): Promise<Buffer> {
  const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const norm = (v: number[]) => {
    const l = Math.hypot(...v);
    return v.map((x) => x / l);
  };
  const Ld = norm([-0.2, -0.7, 0.5]);
  const Lp = norm([0, -1, 1]);
  const base = 0x34 / 255;
  const ch = info.channels;
  const out = Buffer.alloc(info.width * info.height * 3);
  for (let i = 0; i < info.width * info.height; i++) {
    const N = norm([
      data[i * ch]! / 127.5 - 1,
      -(data[i * ch + 1]! / 127.5 - 1),
      data[i * ch + 2]! / 127.5 - 1,
    ]);
    const dot = (L: number[]) => Math.max(0, N[0]! * L[0]! + N[1]! * L[1]! + N[2]! * L[2]!);
    const d = dot(Ld) + 0.5 * dot(Lp);
    // 0.72: exposure so the flat-normal tone lands on the reference charcoal.
    const v = Math.min(255, Math.round(255 * base * (0.6 + d) * 0.72));
    out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = v;
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } })
    .png()
    .toBuffer();
}

/**
 * The blueprint ground: a seamless drafting grid — faint minor lines, a
 * stronger major line every 4th. 128 px at @2x is a 64 CSS px tile with
 * 16 px minor cells.
 */
export async function draftingGrid(): Promise<Buffer> {
  const S = 128;
  let lines = '';
  for (let i = 0; i < 4; i++) {
    const p = i * 32 + 0.5;
    const st =
      i === 0
        ? 'stroke="#7fb2ee" stroke-opacity="0.55" stroke-width="1.6"'
        : 'stroke="#5d93d8" stroke-opacity="0.35" stroke-width="1"';
    lines += `<line x1="0" y1="${p}" x2="${S}" y2="${p}" ${st}/><line x1="${p}" y1="0" x2="${p}" y2="${S}" ${st}/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect width="100%" height="100%" fill="#0b3d91"/>${lines}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Every bake `mlym bake` knows, by preset name. */
export const BAKE_PRESETS: Record<string, BakePreset> = {
  crosshatch: {
    description:
      "Tangram's crosshatch, pre-filtered for MapLibre: hatched paper ground, denser " +
      'landuse hatch, pre-lit crumpled-paper water',
    outputs: ['earth.png', 'landuse.png', 'water.png'],
    bake: async (assets) => [
      // 512 px, declared at pixelRatio 2 in the document: a 256 CSS px tile.
      { filename: 'earth.png', data: await prefilteredHatch(join(assets, 'hatch_0.png'), GROUND_FILTER) },
      { filename: 'landuse.png', data: await prefilteredHatch(join(assets, 'hatch_2.png'), GROUND_FILTER) },
      { filename: 'water.png', data: await litWater(join(assets, 'normal-0031.jpg')) },
    ],
  },
  'crosshatch-walls': {
    description:
      'A pen hatch for building walls (fill-extrusion-pattern), smoothed along the ' +
      'stroke; the crosshatch document itself draws plain lit walls',
    outputs: ['building-hatch.png'],
    // Atlas cells from Tangram's tonal-hatch filter are not tileable (they
    // repeat as a visible grid), so the wall hatch is hatch_0 — Tangram's
    // own light stroke. 512 px; declare it at pixelRatio 4 for strokes finer
    // on walls than on the ground.
    bake: async (assets) => [
      { filename: 'building-hatch.png', data: await prefilteredHatch(join(assets, 'hatch_0.png'), WALL_FILTER) },
    ],
  },
  blueprint: {
    description: 'A drafting-grid ground: minor lines every 16 px, a major line every 64 px',
    outputs: ['grid.png'],
    bake: async () => [{ filename: 'grid.png', data: await draftingGrid() }],
  },
};
