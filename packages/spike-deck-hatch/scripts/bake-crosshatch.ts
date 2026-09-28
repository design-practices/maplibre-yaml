/**
 * @file Bake Tangram's crosshatch textures for the static preset (spike)
 *
 * Tangram draws ground and water UNLIT (earth/landuse: a tile-repeated hatch
 * texture mixed ink→paper; water: a crumpled-paper normal map under the
 * style's fixed lights), so each bakes to a plain image a style.json
 * `*-pattern` can use — the static tier is exact for these, not approximate.
 * Buildings are the lit part: the fallback gets one mid-tone atlas cell.
 *
 *   pnpm --filter @maplibre-yaml/spike-deck-hatch exec tsx scripts/bake-crosshatch.ts
 */
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "../assets/tangram");
const OUT = join(HERE, "../page/crosshatch");

/** Tangram's crosshatch palette (styles/crosshatch.yaml). */
const INK = [77, 77, 78]; // vec3(0.302, 0.302, 0.306)
const PAPER = [249, 243, 227]; // vec3(0.976, 0.953, 0.890)

async function inkOnPaper(
  src: string,
  dst: string,
  crop?: { left: number; top: number; width: number; height: number }
) {
  let img = sharp(join(SRC, src)).ensureAlpha();
  if (crop) img = img.extract(crop);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const a = data[i * 4 + 3]! / 255;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(PAPER[c]! * (1 - a) + INK[c]! * a);
    out[i * 4 + 3] = 255;
  }
  await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toFile(join(OUT, dst));
}

/** Water: Tangram lights normal-0031 on #343434 — dir light (default
 * direction [0.2, 0.7, -0.5], diffuse 1, ambient .3) + point light south of
 * and above centre (diffuse .5, ambient .3). The lights never move, so the
 * lit result is a fixed image. */
async function water() {
  const { data, info } = await sharp(join(SRC, "normal-0031.jpg"))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const norm = (v: number[]) => {
    const l = Math.hypot(...v);
    return v.map((x) => x / l);
  };
  const Ld = norm([-0.2, -0.7, 0.5]);
  const Lp = norm([0, -1, 1]);
  const base = 0x34 / 255;
  const out = Buffer.alloc(info.width * info.height * 3);
  for (let i = 0; i < info.width * info.height; i++) {
    const N = norm([
      data[i * 3]! / 127.5 - 1,
      -(data[i * 3 + 1]! / 127.5 - 1),
      data[i * 3 + 2]! / 127.5 - 1,
    ]);
    const dot = (L: number[]) => Math.max(0, N[0]! * L[0]! + N[1]! * L[1]! + N[2]! * L[2]!);
    const d = dot(Ld) + 0.5 * dot(Lp);
    // 0.72: exposure so the flat-normal tone lands on the reference charcoal.
    const v = Math.min(255, Math.round(255 * base * (0.6 + d) * 0.72));
    out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = v;
  }
  await sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } })
    .png()
    .toFile(join(OUT, "water.png"));
}

await inkOnPaper("hatch_0.png", "earth.png");
await inkOnPaper("hatch_2.png", "landuse.png");
// Static building fallback: one light, SEAMLESS pen hatch on every face
// (atlas cells are not tileable — they tile as a visible grid). hatch_0 is
// Tangram's own light stroke texture; the document declares it at
// pixelRatio 4 so strokes read finer on walls than on the ground.
await inkOnPaper("hatch_0.png", "building-fallback.png");
await water();
console.log("baked → page/crosshatch/{earth,landuse,water,building-fallback}.png");
