---
"@maplibre-yaml/core": minor
---

Layers can set the style spec's `fill-layer-blend`, `line-layer-blend` and
`raster-layer-blend` (`normal`, `multiply`, `color`, `luminosity`,
`plus-lighter`, `screen`, `overlay`; maplibre-gl 6.18), and vector sources
the experimental `sparse: true` (maplibre-gl 6.17). Both are typed in the
schema and the JSON Schema, and `mlym validate` no longer flags them as
unknown keys: the bundled style spec moved to 26.8, which also teaches the
validator the `interpolate-oklab` and `interpolate-oklch` expressions. On a
maplibre-gl older than the release a key needs, the renderer drops that key
with one console notice naming the release instead of letting MapLibre
refuse the whole layer or source, and `mlym emit --target` below it reports
the key as lossy. The new floors are exported as `LAYER_BLEND_RUNTIME_FLOOR`
and `SPARSE_SOURCE_RUNTIME_FLOOR`.

Fixed: an inline layer `source:` of type `vector` or `raster` now reaches
MapLibre with every option you wrote. The inline path copied a fixed list of
fields and silently dropped `scheme`, `promoteId`, `volatile`, `encoding` and
`sparse` on vector sources and `scheme` and `volatile` on raster sources,
while the same source declared under `sources:` kept them; both paths now
hand MapLibre the same object.
