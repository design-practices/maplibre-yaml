---
"@maplibre-yaml/core": patch
---

`load: viewport` now has a limit per view, so zooming a large FlatGeobuf or GeoParquet file out to a whole city no longer reads the whole file (and re-reads it on every pan) until the tab runs out of memory. Before each read the map estimates how many features the view holds — from the FlatGeobuf spatial index or the GeoParquet row groups' extents, without downloading any features — and above the budget it reads nothing: readers see "Too many features to show here — zoom in to see them." over the map until they zoom in, and the author gets a one-time hint with the count. The default is 150,000 features per view; set it with `load: { mode: viewport, maxFeatures: 50000 }` (a whole number, 1 or more). The budget also applies to a file too large to load whole that switched itself to reading by view.
