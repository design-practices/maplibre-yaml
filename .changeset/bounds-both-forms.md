---
"@maplibre-yaml/core": minor
---

`config.bounds` accepts both of MapLibre's forms: four numbers `[west, south, east, north]` and two corners `[[west, south], [east, north]]` (which used to fail with "config.bounds.0: Expected number, got array"). `maxBounds`, format v2's `runtime.map.bounds`/`maxBounds` and a story chapter's `fitBounds` action take both too. A value in neither form is reported once, at its line, with the order spelled out; when the numbers only fit with latitude and longitude swapped, the message gives the swapped value to copy, and an in-range swap far from the map's own places gets an on-page did-you-mean warning, as `center` does. Values that previously validated but crashed MapLibre (a latitude beyond ±90, three numbers) are now validation errors; longitudes past ±180 (bounds crossing the antimeridian) stay allowed.
