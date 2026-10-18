---
"@maplibre-yaml/core": minor
---

When part of a map fails but the rest works, `<ml-map>` now says so on the map. A small dismissible notice at the top of the map lists each problem by name. For example: "Layer `cities` didn't draw: Source "citeis" doesn't exist. Did you mean "cities"?", "Data file `data/x.geojson` didn't load (404 Not Found), so layer `quakes` has no data. The browser looked for https://…/data/x.geojson", or a colour MapLibre rejected inside an expression, with a did-you-mean. Before, the basemap showed, the layer was simply missing, and the reason (if any) was only on the console. It covers layers MapLibre rejects, a `source:` naming a source that doesn't exist, GeoJSON data files that fail to load (now also logged as `console.error`), `images:` entries and marker icons. Basemap tile and glyph errors stay off the page. The notice uses `role="status"`.

A layer that can't be added no longer fails the whole document. The other layers draw, `ml-map:load` fires and `mapReady()` resolves; the failure is dispatched as a non-fatal `ml-map:error` against that layer. Before, `load` never fired and `mapReady()` rejected.

New `quiet` attribute (and `quiet` property): keeps this notice and the zero-height hint off the page, for production sites. Problems are still logged and dispatched as events, and the error card for a map that can't render at all is always shown.
