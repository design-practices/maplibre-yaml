---
"@maplibre-yaml/core": patch
---

A `config.fitTo.source` that names no source (a typo such as `source: place` for `places`) is now reported on the map, not only in the console: the notice says `fitTo.source "place" names no source in sources: — did you mean "places"? The map keeps its own center and zoom.` The console warning gains the same did-you-mean. Hosts using `MapRenderer` directly receive it through `onError` with the new context `{ kind: "fit", sourceId, suggestion }` (non-fatal). This is an additive change (a new `MapErrorContext` kind); existing code needs no action.
