/**
 * @file U12 SPIKE — contract point 3: absence of the runtime → the static preset
 *
 * @description
 * Emits the spike document (page/hatch-effect.yaml) through the REAL CLI
 * pipeline, with a spike-local effects pre-pass modelling what U13's
 * `runtime.effects` lowering must do — without adding any core schema:
 *
 *  1. every `x-effect` declaration yields a `lossy` warning (the screen-space
 *     hatch becomes a zoom-scaled fill-pattern: a visible change), so
 *     `--strict` refuses the document and `--with-fallbacks` accepts it;
 *  2. the effect's `fallback(params)` is computed (hatchTileSvg from the
 *     effect params, @2x like the U10 tiles) and compared, decoded-pixel for
 *     decoded-pixel, with the static tile the document's layer actually
 *     references — proving the document's static layer IS the effect's
 *     fallback, not an unrelated look;
 *  3. the with-fallbacks output is written as a vanilla-maplibre fixture
 *     (style + sprite files + page) for the browser spec to render.
 *
 * Run from packages/cli (so sharp + core resolve as the CLI's do):
 *   node --import tsx ../spike-deck-hatch/scripts/emit-degrade.ts <outDir> <baseUrl>
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { parse } from "yaml";
import {
  YAMLParser,
  finalizeSpriteBaseUrl,
  hatchTileSvg,
  type EmitWarning,
} from "@maplibre-yaml/core";
import { emitStyle } from "../../cli/src/commands/emit.js";
import { rasterizeSpriteFiles, resolveImageRefs } from "../../cli/src/lib/rasterize.js";
import { render, TILE_SIZE } from "../../cli/scripts/crosshatch-tiles.js";

const outDir = process.argv[2];
const baseUrl = process.argv[3];
if (!outDir || !baseUrl) {
  console.error("usage: emit-degrade.ts <outDir> <baseUrl>");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const docText = readFileSync(join(here, "../page/hatch-effect.yaml"), "utf8");
const raw = parse(docText) as {
  images: Record<string, { url: string }>;
  layers: Array<{ id: string; paint?: Record<string, unknown>; "x-effect"?: Record<string, unknown> }>;
};

// --- the spike effects pre-pass (models U13's lowering) --------------------
const effectWarnings: EmitWarning[] = [];
const fallbackChecks: Array<{ layer: string; tile: string; pixelsEqual: boolean }> = [];
for (const layer of raw.layers) {
  const fx = layer["x-effect"];
  if (!fx) continue;
  effectWarnings.push({
    path: `layers.${layer.id}.x-effect`,
    kind: "lossy",
    construct: "effect:hatch-fill",
    message:
      `effect "hatch-fill" on \`${layer.id}\` ejects to its static fallback: ` +
      "screen-space strokes (constant density across zoom) become a fill-pattern " +
      "that scales with the map.",
  } as EmitWarning);

  // fallback(params): the tile the effect would generate for its params.
  const base = {
    spacing: fx["spacing"] as number,
    strokeWidth: fx["thickness"] as number,
    color: fx["color"] as string,
    size: TILE_SIZE,
  };
  const svgs = [hatchTileSvg({ ...base, angle: fx["angle"] as number }).svg];
  if (fx["cross"]) svgs.push(hatchTileSvg({ ...base, angle: -(fx["angle"] as number) }).svg);
  const generated = await sharp(await render(svgs)).raw().toBuffer();

  // …vs the static tile the document's layer references.
  const tileName = layer.paint?.["fill-pattern"] as string;
  const url = raw.images[tileName]!.url;
  const repoPath = join(here, "../../..", new URL(url).pathname);
  const committed = await sharp(readFileSync(repoPath)).raw().toBuffer();
  fallbackChecks.push({ layer: layer.id, tile: tileName, pixelsEqual: generated.equals(committed) });
}

// --- the real emit pipeline --------------------------------------------------
const parsed = YAMLParser.safeParseMapBlock(docText);
if (!parsed.success) throw new Error(JSON.stringify(parsed.errors));

// Strict: the effect's lossy warning must refuse the document.
let strictRefused = false;
{
  const strict = await emitStyle(parsed.data, "strict", { trust: "untrusted" });
  const lossy = [...effectWarnings, ...strict.warnings].filter((w) => w.kind === "lossy");
  strictRefused = lossy.length > 0; // what U13's strict gate would do
}

const { style, warnings, images } = await emitStyle(parsed.data, "with-fallbacks", {
  trust: "untrusted",
});
const allWarnings = [...effectWarnings, ...warnings];
const finalized = finalizeSpriteBaseUrl(style, baseUrl);
const files = await rasterizeSpriteFiles([], await resolveImageRefs(images ?? []));

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="/vendor/maplibre-gl.css">
<style>body{margin:0;} #map{width:100%;height:480px;}</style></head>
<body><div id="map"></div>
<script type="module">
  import "/vendor/maplibre-gl.js";
  const map = new maplibregl.Map({ container: "map", style: "${baseUrl}/style.json" });
  window.__eject = { map };
</script></body></html>`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "style.json"), JSON.stringify(finalized, null, 2));
writeFileSync(join(outDir, "index.html"), html);
for (const file of files) writeFileSync(join(outDir, file.filename), file.data);
const result = {
  strictRefused,
  lossy: allWarnings.filter((w) => w.kind === "lossy"),
  xEffectStripped: !JSON.stringify(finalized).includes("x-effect"),
  contractWarnings: allWarnings.filter((w) => w.kind === "contract").map((w) => w.path),
  fallbackChecks,
};
writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
