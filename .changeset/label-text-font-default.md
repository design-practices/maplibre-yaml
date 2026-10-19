---
"@maplibre-yaml/core": patch
---

A label layer (`type: symbol` with `text-field`) that doesn't set `text-font` now uses the basemap's own font. MapLibre's default font stack ("Open Sans Regular, Arial Unicode MS Regular") doesn't exist on OpenFreeMap and most other basemaps, so every such layer filled the console with glyph 404s and a warning per character. The layer now borrows the basemap's "Regular" font (Noto Sans Regular on OpenFreeMap Liberty), or, if the basemap has none, the font its labels use most. If the basemap names no font at all, the console says once which layer needs a `text-font` and how to add one. A `text-font` you set is never changed.
