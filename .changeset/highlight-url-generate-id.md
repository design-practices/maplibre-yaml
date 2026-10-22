---
"@maplibre-yaml/core": patch
---

`hover.highlight` now works on GeoJSON loaded from `url:`. Feature-state needs feature ids, and the library turned on `generateId` for a highlighted layer's inline `data:` only; a file loaded by `url:` (a GeoJSON file in `public/`, the most common setup), a named `sources:` entry, or a FlatGeobuf or GeoParquet file decoded to GeoJSON got a "needs feature ids" console warning and no highlight. Every GeoJSON source a highlighted layer draws from now gets `generateId: true`, without a warning, unless the author set `generateId` or `promoteId` — and an authored `generateId: false` is now respected rather than overridden, for data whose own numeric ids should be kept. Generated ids stay stable across `merge` refreshes, which keep each feature in place.
