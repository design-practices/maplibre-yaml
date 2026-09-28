/**
 * @file Generate the crosshatch eject fixture (e2e/classics-crosshatch.spec.ts)
 *
 * @description
 * The static classic's "same map after eject" claim, driven through the REAL
 * pipeline on the hermetic twin document: `emitStyle` in STRICT mode (a
 * static preset must eject with zero lossy warnings — strict throws
 * otherwise) → `finalizeSpriteBaseUrl` → `resolveImageRefs` (fetches the
 * two hatch tiles from the running e2e server) → `rasterizeSpriteFiles`.
 * What lands on disk is exactly what `mlym emit --strict --out --sprite-base`
 * writes; the spec renders it in a plain `maplibregl.Map` with zero library
 * code, beside the live `<ml-map>` twin.
 *
 * Requires the e2e server (the document's basemap and images are absolute
 * localhost URLs) — Playwright's webServer is up before `beforeAll` runs.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { YAMLParser, finalizeSpriteBaseUrl } from "@maplibre-yaml/core";
import { emitStyle } from "../src/commands/emit.js";
import { rasterizeSpriteFiles, resolveImageRefs } from "../src/lib/rasterize.js";

const outDir = process.argv[2];
const baseUrl = process.argv[3];
if (!outDir || !baseUrl) {
  console.error("usage: generate-crosshatch-eject-fixture.ts <outDir> <baseUrl>");
  process.exit(1);
}

const docPath = join(process.cwd(), "../../examples/gallery/configs/crosshatch.yaml");
const parsed = YAMLParser.safeParseMapBlock(readFileSync(docPath, "utf8"));
if (!parsed.success) throw new Error(JSON.stringify(parsed.errors));

const { style, warnings, images } = await emitStyle(parsed.data, "strict", {
  trust: "untrusted",
});
if (!images || images.length !== 2) throw new Error("expected both hatch tiles as image refs");

const finalized = finalizeSpriteBaseUrl(style, baseUrl);
const files = await rasterizeSpriteFiles([], await resolveImageRefs(images));

// Same box as examples/gallery/viewer.html's <ml-map> (full width × 480px,
// body margin 0) so the spec can compare the two renders like for like.
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
writeFileSync(join(outDir, "warnings.json"), JSON.stringify(warnings, null, 2));
writeFileSync(join(outDir, "index.html"), html);
for (const file of files) writeFileSync(join(outDir, file.filename), file.data);
console.log(`wrote crosshatch eject fixture (${warnings.length} warnings) to ${outDir}`);
