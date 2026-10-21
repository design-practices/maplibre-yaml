---
"@maplibre-yaml/core": patch
---

`fitTo` now keeps a margin around the data when `padding:` isn't given, so the circles and icons at the data's edges are drawn whole and the bottom one isn't hidden under MapLibre's attribution on a phone. The margin is 8% of the map's shorter side, between 12 and 48 pixels (48 on a desktop window, about 30 on a phone, so the data doesn't shrink on a small screen), with the room MapLibre's bottom controls take added at the bottom — measured on the map, with the attribution counted expanded, so tapping its (i) button on a phone doesn't cover the data. Before, `fitTo` framed the data's exact extent. An explicit `padding:` is used as given; `padding: 0` frames the exact extent as before. `mlym emit` computes the exported camera with the same default.
