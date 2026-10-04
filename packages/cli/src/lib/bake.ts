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
 * image that a `*-pattern` reproduces exactly, not approximately. Buildings
 * are the lit part of the look; their static fallback is one light, seamless
 * pen hatch on every face, shaded by the document's `light:`.
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

/**
 * Ink-on-paper: the source texture's alpha is stroke coverage, mixed from
 * PAPER (no stroke) to INK (full stroke), output opaque.
 */
export async function inkOnPaper(src: string): Promise<Buffer> {
  const { data, info } = await sharp(src)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const a = data[i * 4 + 3]! / 255;
    for (let c = 0; c < 3; c++) {
      out[i * 4 + c] = Math.round(PAPER[c]! * (1 - a) + INK[c]! * a);
    }
    out[i * 4 + 3] = 255;
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
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
      "Tangram's crosshatch: hatched paper ground, denser landuse hatch, pre-lit " +
      'crumpled-paper water, and a light pen hatch for building faces',
    outputs: ['earth.png', 'landuse.png', 'water.png', 'building-fallback.png'],
    bake: async (assets) => [
      { filename: 'earth.png', data: await inkOnPaper(join(assets, 'hatch_0.png')) },
      { filename: 'landuse.png', data: await inkOnPaper(join(assets, 'hatch_2.png')) },
      { filename: 'water.png', data: await litWater(join(assets, 'normal-0031.jpg')) },
      // Atlas cells from Tangram's tonal-hatch filter are not tileable (they
      // repeat as a visible grid), so the static building face reuses
      // hatch_0 — Tangram's own light stroke — declared at pixelRatio 4 in
      // the document so strokes read finer on walls than on the ground.
      {
        filename: 'building-fallback.png',
        data: await inkOnPaper(join(assets, 'hatch_0.png')),
      },
    ],
  },
  blueprint: {
    description: 'A drafting-grid ground: minor lines every 16 px, a major line every 64 px',
    outputs: ['grid.png'],
    bake: async () => [{ filename: 'grid.png', data: await draftingGrid() }],
  },
};
