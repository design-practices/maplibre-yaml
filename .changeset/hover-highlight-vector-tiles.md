---
"@maplibre-yaml/core": patch
---

`hover.highlight` now works on vector-tile sources — PMTiles archives and plain `tiles:` URLs. Before, every mouse move over such a layer logged "The sourceLayer parameter must be provided for vector source types" and nothing lit; the highlight now names the feature's tile layer, both when it lights a feature and when it clears it. Tiles that carry no feature ids can't be highlighted, so instead of failing on every move the map tells the author once — on the console, and on the page while developing — to add `promoteId: { <source-layer>: <property> }` to the source.
