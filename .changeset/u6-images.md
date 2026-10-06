---
"@maplibre-yaml/core": minor
"@maplibre-yaml/cli": minor
---

`images:` — named images for symbol layers and patterns (R9), the format's
first style-half construct that exports through the sprite pipeline. Each
entry (`name: url` or `{url, sdf?, pixelRatio?}`, at the v1 document root or
under the v2 style half) loads via `map.addImage` BEFORE layers are added,
so `icon-image`/`*-pattern` references resolve on first render; failures
warn once per name (with an `ml-map:image-error` event) and never kill the
document, and an unknown referenced name gets a warn-once
`styleimagemissing` note instead of MapLibre's per-render spam.

On export the construct fully compiles — class `exports`, so `--strict`
accepts it: `mlym emit` fetches every image at compile time (the pipeline's
second networked step, beside basemap resolution), merges it into the
document sprite next to generated assets (SDF flags carried into the sprite
index), and rewrites literal image references to `mlym:<name>`. Marker
`icon:` URLs ride the same pipeline, lifting U5's icon limitation: exported
icon markers now render their images instead of substituting default pins.
`EmitResult` widens with `images?` (fetch-at-emit refs) for programmatic
consumers. Reference rewriting is expression-position-aware (match labels,
`["get"]` arguments, and operators survive name collisions); dynamic
references and relative URLs are reported instead of silently diverging
(relative URLs are lossy — `--strict` refuses them). Emit fetches are
bounded (30s timeout, 20MB/1024px ceilings, batched concurrency), live
image loads time out after 10s instead of stalling `mapReady()`, and
`--strict` now also refuses lossy warnings added by the basemap merge.
Three more gallery pages flip to YAML (add an icon, fallback image,
polygon pattern).
