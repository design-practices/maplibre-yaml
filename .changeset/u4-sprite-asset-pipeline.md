---
"@maplibre-yaml/core": minor
"@maplibre-yaml/cli": minor
---

The sprite/asset pipeline (R7) — shared infrastructure for every construct
that ejects via generated raster assets (marker pins, pattern presets, effect
fallbacks). Core describes: deterministic SVG asset descriptors with
content-hashed names (`fx-hatch-45-8-a1b2c3d4`), a name-sorted sprite-index
layout, and `attachSpriteAssets()` which declares the document sprite in the
spec's array form under the fixed `mlym` id — `EmitResult` gains an optional
`assets` field carrying the descriptors, and core stays dependency-free. The
CLI rasterizes: `mlym emit --out` now writes the standard four-file sprite
set (`mlym.png`/`mlym.json` + `@2x`) beside the style when a document
generates assets (sharp, pinned exact, loaded lazily so asset-free documents
never pay for it); emitting an asset-bearing document to stdout warns that
sprite files need `--out`. Basemap sprite merging is fixed in the process:
the basemap's icons survive under `default` while document assets ride
`mlym` (array-form sprite, id collisions warn as lossy) — previously a
document sprite silently clobbered the basemap's entire icon set.
