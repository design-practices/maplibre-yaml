/**
 * @file U12 SPIKE session 2 — the crosshatch document's eject (degrade) path
 *
 * Emits page/crosshatch.yaml through the REAL `mlym emit` pipeline with the
 * spike's effects pre-pass (models U13's lowering): every
 * `x-effect: crosshatch-buildings` yields one `lossy` warning (so --strict
 * refuses), the block is stripped, and the static layer it rides — the
 * preset's hatched fill-extrusion — is what ejects. Writes a vanilla
 * maplibre-gl page over the ejected style.json for the browser spec.
 *
 * Run from packages/cli (so sharp + core resolve as the CLI's do):
 *   node --import tsx ../spike-deck-hatch/scripts/emit-crosshatch.ts <outDir> <origin>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { YAMLParser, finalizeSpriteBaseUrl, type EmitWarning } from "@maplibre-yaml/core";
import { emitStyle } from "../../cli/src/commands/emit.js";
import { rasterizeSpriteFiles, resolveImageRefs } from "../../cli/src/lib/rasterize.js";

const [outDir, origin] = process.argv.slice(2);
if (!outDir || !origin) {
  console.error("usage: emit-crosshatch.ts <outDir> <origin>");
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const PAGE = `${origin}/packages/spike-deck-hatch/page`;

// Hermetic + fetchable: absolute image URLs (emit fetches them into the
// sprite), fixture tiles, the suite's glyph-stub base style.
const doc = parse(readFileSync(join(here, "../page/crosshatch.yaml"), "utf8"));
for (const img of Object.values(doc.images) as Array<{ url: string }>) {
  img.url = `${PAGE}/${img.url.replace(/^\.\//, "")}`;
}
delete doc.sources.omt.url;
doc.sources.omt.tiles = [`${origin}/packages/spike-deck-hatch/fixtures/omt/{z}/{x}/{y}.pbf`];
doc.sources.omt.minzoom = 13;
doc.sources.omt.maxzoom = 14;
doc.config.mapStyle = `${origin}/examples/verification/configs/local-style.json`;

const effectWarnings: EmitWarning[] = [];
for (const layer of doc.layers as Array<{ id: string; "x-effect"?: { type: string } }>) {
  if (layer["x-effect"]?.type !== "crosshatch-buildings") continue;
  effectWarnings.push({
    path: `layers.${layer.id}.x-effect`,
    kind: "lossy",
    construct: "effect:crosshatch-buildings",
    message:
      `effect "crosshatch-buildings" on \`${layer.id}\` ejects to its static fallback: ` +
      "tonal hatching (stroke density following light per face) and ink outlines " +
      "become one flat hatch pattern on every face.",
  } as EmitWarning);
}

const parsed = YAMLParser.safeParseMapBlock(stringify(doc));
if (!parsed.success) throw new Error(JSON.stringify(parsed.errors));

const strict = await emitStyle(parsed.data, "strict", { trust: "untrusted" });
const strictRefused = [...effectWarnings, ...strict.warnings].some((w) => w.kind === "lossy");

const { style, warnings, images } = await emitStyle(parsed.data, "with-fallbacks", { trust: "untrusted" });
const all = [...effectWarnings, ...warnings];
const finalized = finalizeSpriteBaseUrl(style, `${origin}/e2e/generated/spike-crosshatch`);
const files = await rasterizeSpriteFiles([], await resolveImageRefs(images ?? []));
const cam = doc.config;
const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="/vendor/maplibre-gl.css">
<style>html,body,#map{margin:0;width:100%;height:100%;}</style></head>
<body><div id="map"></div>
<script type="module">
  import "/vendor/maplibre-gl.js";
  const map = new maplibregl.Map({ container: "map", style: "./style.json",
    center: ${JSON.stringify(cam.center)}, zoom: ${cam.zoom}, pitch: ${cam.pitch}, bearing: ${cam.bearing} });
  window.__eject = { map };
</script></body></html>`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "style.json"), JSON.stringify(finalized, null, 2));
writeFileSync(join(outDir, "index.html"), html);
for (const f of files) writeFileSync(join(outDir, f.filename), f.data);
const styleText = JSON.stringify(finalized);
const result = {
  strictRefused,
  lossy: all.filter((w) => w.kind === "lossy").map((w) => w.path),
  xEffectStripped: !styleText.includes("x-effect"),
  buildingsLayer: (finalized.layers as Array<{ id: string; type: string; paint?: Record<string, unknown> }>)
    .filter((l) => l.id === "buildings")
    .map((l) => ({ type: l.type, pattern: l.paint?.["fill-extrusion-pattern"] })),
  layerIds: (finalized.layers as Array<{ id: string }>).map((l) => l.id),
  sprite: finalized.sprite,
};
writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
