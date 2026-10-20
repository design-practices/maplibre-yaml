---
"@maplibre-yaml/core": patch
---

`fitTo` now keeps a margin around the data when `padding:` isn't given, so the circles and icons at the data's edges are drawn whole and the bottom one isn't hidden under MapLibre's attribution on a phone. The margin is 8% of the map's shorter side, between 12 and 48 pixels (48 on a desktop window, about 30 on a phone, so the data doesn't shrink on a small screen), with room for the attribution added at the bottom. Before, `fitTo` framed the data's exact extent. An explicit `padding:` is used as given; `padding: 0` frames the exact extent as before. `mlym emit` computes the exported camera with the same default.
