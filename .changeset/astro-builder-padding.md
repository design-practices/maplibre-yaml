---
"@maplibre-yaml/astro": patch
---

`buildMultiPointMapConfig` and `buildRouteMapConfig` now apply their `padding` option. It was accepted and documented (default 50 pixels) but never reached the map, so the points or route were fitted edge to edge. The built config now carries `fitBoundsOptions: { padding }` next to `bounds`, so the map leaves that many pixels between your data and the map edge.
