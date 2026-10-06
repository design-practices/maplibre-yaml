/**
 * @file Generate the effects export browser fixture (e2e/effects.spec.ts, U13′)
 *
 * @description
 * The crosshatch classic — whose buildings carry `effect: tonal-hatch` —
 * through the REAL `mlym emit` pipeline (emitStyle → finalizeSpriteBaseUrl →
 * rasterize), exactly as `mlym emit --out --sprite-base` would. The CLI does
 * not load @maplibre-yaml/effects, which is the point: the effect must export
 * to its static layer with one `lossy` warning (so `--strict` refuses), and
 * the emitted style must render the hatched buildings in plain maplibre-gl.
 *
 *   node --import tsx scripts/generate-effects-export-fixture.ts <outDir> <origin>
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { YAMLParser, finalizeSpriteBaseUrl, EmitError } from "@maplibre-yaml/core";
import { emitStyle } from "../src/commands/emit.js";
import { rasterizeSpriteFiles, resolveImageRefs } from "../src/lib/rasterize.js";

const [outDir, origin] = process.argv.slice(2);
if (!outDir || !origin) {
  console.error("usage: generate-effects-export-fixture.ts <outDir> <origin>");
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const FX = join(here, "../../../examples/verification/effects");
const PAGE = `${origin}/examples/verification/effects`;

// Hermetic and fetchable: absolute image URLs (emit fetches them into the
// sprite) and the fixture tiles, all on the local verification server.
const yaml = readFileSync(join(FX, "crosshatch.yaml"), "utf8")
  .replaceAll("{{origin}}", origin)
  .replaceAll('url: "./', `url: "${PAGE}/`);
const parsed = YAMLParser.safeParseMapBlock(yaml);
if (!parsed.success) throw new Error(JSON.stringify(parsed.errors));

let strictRefused = false;
let strictLossy: string[] = [];
try {
  await emitStyle(parsed.data, "strict", { trust: "untrusted" });
} catch (error) {
  if (!(error instanceof EmitError)) throw error;
  strictRefused = true;
  strictLossy = error.warnings.filter((w) => w.kind === "lossy").map((w) => w.path);
}

const { style, warnings, images } = await emitStyle(parsed.data, "with-fallbacks", { trust: "untrusted" });
const finalized = finalizeSpriteBaseUrl(style, `${origin}/e2e/generated/effects-export`);
const files = await rasterizeSpriteFiles([], await resolveImageRefs(images ?? []));
const cam = (parsed.data as { config: { center: number[]; zoom: number; pitch: number; bearing: number } }).config;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="/vendor/maplibre-gl.css">
<style>html,body,#map{margin:0;width:100%;height:100%;}</style></head>
<body><div id="map"></div>
<script type="module">
  import "/vendor/maplibre-gl.js";
  const map = new maplibregl.Map({ container: "map", style: "./style.json",
    center: ${JSON.stringify(cam.center)}, zoom: ${cam.zoom}, pitch: ${cam.pitch}, bearing: ${cam.bearing},
    canvasContextAttributes: { preserveDrawingBuffer: true } });
  window.__export = { map };
</script></body></html>`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "style.json"), JSON.stringify(finalized, null, 2));
writeFileSync(join(outDir, "index.html"), html);
for (const f of files) writeFileSync(join(outDir, f.filename), f.data);
const styleText = JSON.stringify(finalized);
const result = {
  strictRefused,
  strictLossy,
  lossy: warnings.filter((w) => w.kind === "lossy").map((w) => w.path),
  effectWarnings: warnings.filter((w) => w.construct === "layer.effect").map((w) => w.message),
  effectStripped: !styleText.includes('"effect"'),
  buildings: (finalized["layers"] as Array<{ id: string; type: string; paint?: Record<string, unknown> }>)
    .filter((l) => l.id === "buildings")
    .map((l) => ({ type: l.type, pattern: l.paint?.["fill-extrusion-pattern"] })),
};
writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
