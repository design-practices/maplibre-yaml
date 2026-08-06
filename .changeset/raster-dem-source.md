---
"@maplibre-yaml/core": minor
---

Add the `raster-dem` source type (schema-truthfulness U6). `hillshade` has always been a valid layer type, but there was no valid source to feed it — the elevation-tile source MapLibre requires was missing from the union, so a hillshade map could not be expressed at all.

`RasterDEMSourceSchema` mirrors the raster source (url-or-tiles requirement, `tileSize`, zoom/bounds/attribution) plus `encoding: terrarium | mapbox | custom`, defaulting to `mapbox` to match MapLibre. Custom encodings carry `redFactor`/`greenFactor`/`blueFactor`/`baseShift` through passthrough. Map-level 3D `terrain:` configuration remains out of scope; this covers hillshade sourcing only.

Registered everywhere the source union fans out: `LayerSourceSchema`, `markOpenSchema`, `SOURCE_TYPES`, and a `raster-dem` branch in `LayerManager.addSource`. Because `SOURCE_TYPES` grew, the "Unknown source type" message now reads `geojson, vector, raster, raster-dem, image, video`, and did-you-mean resolves `raster-dme` to `raster-dem`. Emitted JSON Schemas gain the new union member; snapshots updated deliberately alongside the behavior change.

The docs gain a Raster DEM section with a complete hillshade map example, plus a `hillshade-demo.yaml` config fixture that is validated against both the Zod parser and the emitted JSON Schema.

**Also fixes tile URL templates in the published JSON Schema.** Tile arrays were typed `z.string().url()`, which emitted `format: "uri"` — and `{z}/{x}/{y}` placeholders are not legal URI characters, so every standard XYZ tile template was reported invalid by editors and by agents generating configs, including the templates in our own documentation. The parser had always accepted them, making this a schema-vs-runtime disagreement of exactly the kind this release is closing. `tiles` entries now validate as URLs with placeholders substituted, and emit as plain strings. Affects `vector`, `raster`, and `raster-dem`.

