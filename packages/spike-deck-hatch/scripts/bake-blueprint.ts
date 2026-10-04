/**
 * @file Bake the blueprint example's ground texture (spike)
 *   pnpm --filter @maplibre-yaml/spike-deck-hatch exec tsx scripts/bake-blueprint.ts
 * A seamless drafting grid: faint minor lines, stronger major lines every 4th.
 */
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../page/blueprint");
const S = 128; // @2x → 64 CSS px tile, 16 px minor cells
let lines = "";
for (let i = 0; i < 4; i++) {
  const p = i * 32 + 0.5;
  const major = i === 0;
  const st = major ? 'stroke="#7fb2ee" stroke-opacity="0.55" stroke-width="1.6"' : 'stroke="#5d93d8" stroke-opacity="0.35" stroke-width="1"';
  lines += `<line x1="0" y1="${p}" x2="${S}" y2="${p}" ${st}/><line x1="${p}" y1="0" x2="${p}" y2="${S}" ${st}/>`;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect width="100%" height="100%" fill="#0b3d91"/>${lines}</svg>`;
await sharp(Buffer.from(svg)).png().toFile(join(OUT, "grid.png"));
console.log("baked → page/blueprint/grid.png");
