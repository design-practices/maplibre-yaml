---
"@maplibre-yaml/core": minor
---

maplibre-gl v5 foundations. `maplibre-gl` is no longer a runtime `dependency`
of core — it was pinned `^4.1.0` alongside the peer declaration, so package
managers could install a second, private v4 copy next to your v5; it is now
peer (+ dev) only, matching the documented architecture. A document's `state:`
block now actually reaches the live map: defaults are applied via
`setGlobalStateProperty` on load (maplibre-gl ≥ 5.6), so `global-state`
expressions in filters and paint read the declared values instead of null; on
older runtimes a declared `state:` warns once instead of silently doing
nothing. The flat WebGL context keys (`antialias`, `preserveDrawingBuffer`,
`failIfMajorPerformanceCaveat`) are handed to MapLibre in both the v4 shape
and v5's `canvasContextAttributes`, so they keep working across the peer
range. Validation allowlists regenerate from style-spec 26.4.4, adding six
newer spec keys (`fill-layer-opacity`, `line-layer-opacity`, `resampling`,
`fill-extrusion-rounded-corner-distance`, `symbol-height-anchor`,
`symbol-height-offset`) that no longer trip unknown-key warnings.
