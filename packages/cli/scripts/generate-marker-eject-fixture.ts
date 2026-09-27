/**
 * @file Generate the U5 marker-eject browser fixture (e2e/marker-eject.spec.ts)
 *
 * @description
 * AE1's marker half, driven through the REAL pipeline: a YAML `markers:`
 * document → `emitStyle` (`--with-fallbacks` semantics: lowerMarkers →
 * projectStyle → attachSpriteAssets) → `finalizeSpriteBaseUrl` →
 * `rasterizeSpriteFiles`. What lands on disk is exactly what
 * `mlym emit --out --sprite-base` writes; the spec renders it in a plain
 * `maplibregl.Map` with zero library code.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { YAMLParser, finalizeSpriteBaseUrl, MARKERS_LAYER_ID } from "@maplibre-yaml/core";
import { emitStyle } from "../src/commands/emit.js";
import { rasterizeSpriteFiles } from "../src/lib/rasterize.js";

const outDir = process.argv[2];
const baseUrl = process.argv[3];
if (!outDir || !baseUrl) {
  console.error("usage: generate-marker-eject-fixture.ts <outDir> <baseUrl>");
  process.exit(1);
}

const DOC = `
type: map
id: pins
config:
  center: [0, 0]
  zoom: 2
markers:
  - at: [0, 0]
    color: "#e63946"
  - at: [20, 10]
`;

const parsed = YAMLParser.safeParseMapBlock(DOC);
if (!parsed.success) throw new Error(JSON.stringify(parsed.errors));

const { style, warnings, assets } = await emitStyle(parsed.data, "with-fallbacks", {
  trust: "untrusted",
});
if (!assets || assets.length === 0) throw new Error("expected pin assets from the lowering");
if (!warnings.some((w) => w.construct === "markers" && w.kind === "lossy")) {
  throw new Error("expected the lossy markers lowering warning");
}

const finalized = finalizeSpriteBaseUrl(style, baseUrl);
// The doc declares no basemap; give the emitted style a visible backdrop.
(finalized["layers"] as unknown[]).unshift({
  id: "bg",
  type: "background",
  paint: { "background-color": "#ffffff" },
});
const files = await rasterizeSpriteFiles(assets);

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="/vendor/maplibre-gl.css">
<style>html,body,#map{margin:0;height:100%;}</style></head>
<body><div id="map"></div>
<script type="module">
  import "/vendor/maplibre-gl.js";
  const map = new maplibregl.Map({
    container: "map",
    style: "${baseUrl}/style.json",
    center: [0, 0],
    zoom: 2,
    preserveDrawingBuffer: true,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  window.__eject = { map, layerId: ${JSON.stringify(MARKERS_LAYER_ID)} };
</script></body></html>`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "style.json"), JSON.stringify(finalized, null, 2));
writeFileSync(join(outDir, "index.html"), html);
for (const file of files) writeFileSync(join(outDir, file.filename), file.data);
console.log(`wrote marker-eject fixture (${assets.length} pin assets) to ${outDir}`);
