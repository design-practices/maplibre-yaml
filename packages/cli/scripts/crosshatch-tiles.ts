/**
 * @file The crosshatch classic's raster tiles (U10, R13) — generator + writer
 *
 * @description
 * The crosshatch preset is a pure style-spec document: two `images:` entries
 * (a single-diagonal hatch and a true crosshatch) feeding `fill-pattern`.
 * The tiles themselves are GENERATED, not drawn by hand, from core's
 * seamless {@link hatchTileSvg} generator — the same generator the sprite
 * pipeline (U4) and a future animated hatch effect's fallback use, so the
 * static preset and the effect's eject target can never drift apart in look.
 *
 * The PNGs are committed (docs/public/configs/gallery/assets/) because
 * `images:` loads a URL, live and at emit time; `test/classics.test.ts`
 * regenerates them in memory and compares decoded pixels, so a generator
 * change that isn't re-committed fails presubmit instead of silently
 * diverging.
 *
 * Regenerate after changing the parameters below:
 *
 *   pnpm --filter @maplibre-yaml/cli exec node --import tsx scripts/crosshatch-tiles.ts
 */

import sharp from "sharp";
import { hatchTileSvg } from "@maplibre-yaml/core";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Tile edge, CSS px. The PNG is rendered at @2x (declared `pixelRatio: 2`). */
export const TILE_SIZE = 32;
/** Ink color shared by both tiles (and the preset's outline layer). */
export const INK = "#1d3557";

const HATCH = { spacing: 8, strokeWidth: 1.25, color: INK, size: TILE_SIZE } as const;

/** Where the committed tiles live, relative to the repo root. */
export const TILE_DIR = "docs/public/configs/gallery/assets";

export const TILES = {
  /** One diagonal family — the "light" tone. */
  "crosshatch-light.png": () => render([hatchTileSvg({ ...HATCH, angle: 45 }).svg]),
  /** Both diagonals — the "dark" tone, the classic crosshatch. */
  "crosshatch-dark.png": () =>
    render([
      hatchTileSvg({ ...HATCH, angle: 45 }).svg,
      hatchTileSvg({ ...HATCH, angle: -45 }).svg,
    ]),
} as const;

/** Rasterize SVG layers at @2x and composite them onto one transparent tile. */
async function render(svgs: string[]): Promise<Buffer> {
  const px = TILE_SIZE * 2;
  const layers = await Promise.all(
    svgs.map((svg) =>
      sharp(Buffer.from(svg), { density: 144 }).resize(px, px).png().toBuffer()
    )
  );
  return sharp({
    create: { width: px, height: px, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(layers.map((input) => ({ input, left: 0, top: 0 })))
    .png()
    .toBuffer();
}

// Writer entry point (only when run directly, not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const dir = join(root, TILE_DIR);
  mkdirSync(dir, { recursive: true });
  for (const [name, make] of Object.entries(TILES)) {
    writeFileSync(join(dir, name), await make());
    console.log(`wrote ${join(TILE_DIR, name)}`);
  }
}
