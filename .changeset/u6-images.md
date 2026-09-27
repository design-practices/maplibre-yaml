---
"@maplibre-yaml/core": minor
"@maplibre-yaml/cli": minor
---

`images:` — named images for symbol layers and patterns (R9), the format's
first style-half construct that ejects through the sprite pipeline. Each
entry (`name: url` or `{url, sdf?, pixelRatio?}`, at the v1 document root or
under the v2 style half) loads via `map.addImage` BEFORE layers are added,
so `icon-image`/`*-pattern` references resolve on first render; failures
warn once per name (with an `ml-map:image-error` event) and never kill the
document, and an unknown referenced name gets a warn-once
`styleimagemissing` note instead of MapLibre's per-render spam.

On eject the construct fully compiles — class **ejects**, so `--strict`
accepts it: `mlym emit` fetches every image at compile time (the pipeline's
second networked step, beside basemap resolution), merges it into the
document sprite next to generated assets (SDF flags carried into the sprite
index), and rewrites literal image references to `mlym:<name>`. Marker
`icon:` URLs ride the same pipeline, lifting U5's icon limitation: ejected
icon markers now render their images instead of substituting default pins.
`EmitResult` widens with `images?` (fetch-at-emit refs) for programmatic
consumers. Three more gallery pages flip to Pure YAML (add an icon,
fallback image, polygon pattern).
