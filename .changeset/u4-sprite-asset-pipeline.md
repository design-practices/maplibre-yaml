---
"@maplibre-yaml/core": minor
"@maplibre-yaml/cli": minor
---

The sprite/asset pipeline (R7) — shared infrastructure for every construct
that ejects via generated raster assets (marker pins, pattern presets, effect
fallbacks). Core describes: deterministic SVG asset descriptors with
content-hashed names (`fx-hatch-45-8-a1b2c3d4`), a name-sorted sprite-index
layout (duplicate names dedupe when identical, throw when they'd alias
different images), seamless hatch tiles (requested angle/spacing snap to the
nearest periodic lattice so strokes never jog at tile boundaries), and
`attachSpriteAssets()`/`finalizeSpriteBaseUrl()` declaring the document
sprite under the fixed `mlym` id in the spec's array form. `EmitResult`
gains an optional `assets` field; `EjectLowering.assets` now shares the same
`EmitAsset` vocabulary (the placeholder `EjectAssetDescriptor` type is gone
before anything consumed it).

The CLI rasterizes: `mlym emit --out` writes the standard four-file sprite
set (`mlym.png`/`mlym.json` + `@2x`) beside the style (sharp, pinned exact,
loaded lazily). MapLibre rejects relative sprite URLs, so asset-bearing
documents require `--sprite-base <url-prefix>` (the deployed location) and
`--out` — emitting a style whose sprite could never resolve now fails loudly
instead of shipping broken. Rasterization runs before anything is written,
so a sharp failure never leaves a style referencing missing files. Basemap
sprite merging is fixed in the process: basemap icons survive under
`default` while document assets ride `mlym` (id collisions warn as lossy) —
previously a document sprite silently clobbered the basemap's entire icon
set. cli's `engines.node` floor rises to match sharp's
(`^18.17.0 || ^20.3.0 || >=21`).
