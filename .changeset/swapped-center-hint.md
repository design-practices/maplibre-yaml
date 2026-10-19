---
"@maplibre-yaml/core": patch
---

A map whose `center` is written latitude first (`center: [40.75, -73.98]`, the order many web maps display) now says so on the map instead of opening on an empty spot with no hint. Once the document's data has loaded (inline or from a file), if the center is far from it (further than the data is spread out) and the swapped pair lands on it, the notice says: "`center` is [40.75, -73.98], but this map's data is around [-73.98, 40.75]. Coordinates are [longitude, latitude]: did you mean center: [-73.98, 40.75]?" Maps framed by `fitTo` or `bounds` aren't checked, since their center isn't used. `MapErrorContext` gains a `"center"` kind with `center` and `swapped` fields; this is an additive change and needs no action.
