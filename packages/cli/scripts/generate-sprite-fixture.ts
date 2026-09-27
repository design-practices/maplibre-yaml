/**
 * @file Generate the U4 sprite-pipeline browser fixture (e2e/sprite-assets.spec.ts)
 *
 * @description
 * Runs under real Node ESM (`node --import tsx`) from this package, so the
 * bare `@maplibre-yaml/core` import resolves exactly the way a consumer's
 * does. Writes a self-contained vanilla-maplibre page + emitted style +
 * rasterized sprite set into the directory given as argv[2], with sprite
 * URLs based at argv[3].
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  hatchTileSvg,
  attachSpriteAssets,
  finalizeSpriteBaseUrl,
  DOCUMENT_SPRITE_ID,
  type EmitResult,
} from "@maplibre-yaml/core";
import { rasterizeSpriteFiles } from "../src/lib/rasterize.js";

const outDir = process.argv[2];
const baseUrl = process.argv[3];
if (!outDir || !baseUrl) {
  console.error("usage: generate-sprite-fixture.ts <outDir> <baseUrl>");
  process.exit(1);
}

const asset = hatchTileSvg({ angle: 45, spacing: 6, strokeWidth: 2, color: "#7b2cbf" });

// The same attach → finalize path `mlym emit --out --sprite-base` runs, so
// the twin consumes the sprite declaration the library actually ships.
const attached = attachSpriteAssets(
  { style: { version: 8 }, warnings: [], placements: [] } as unknown as EmitResult,
  [asset]
);
const spriteRoot = finalizeSpriteBaseUrl(attached.style, baseUrl)["sprite"];
const files = await rasterizeSpriteFiles(attached.assets!);

const style = {
  version: 8,
  sprite: spriteRoot,
  sources: {
    square: {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [[[-20, -20], [20, -20], [20, 20], [-20, 20], [-20, -20]]],
        },
      },
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#ffffff" } },
    {
      id: "hatched",
      type: "fill",
      source: "square",
      paint: { "fill-pattern": `${DOCUMENT_SPRITE_ID}:${asset.name}` },
    },
  ],
};

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
    // The spec's pixel probe reads the canvas back; WebGL buffers are
    // cleared after compositing without this.
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  window.__sprite = { map, pattern: ${JSON.stringify(`${DOCUMENT_SPRITE_ID}:${asset.name}`)} };
</script></body></html>`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "style.json"), JSON.stringify(style, null, 2));
writeFileSync(join(outDir, "index.html"), html);
for (const file of files) writeFileSync(join(outDir, file.filename), file.data);
console.log(`wrote fixture (pattern ${asset.name}) to ${outDir}`);
