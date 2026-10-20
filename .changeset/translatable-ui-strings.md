---
"@maplibre-yaml/core": minor
"@maplibre-yaml/astro": patch
---

Every piece of text the library puts on a map can now be translated through the same `locale:` table MapLibre reads for its controls (`config.locale`, or `runtime.map.locale` in v2). The library's keys start with `maplibre-yaml.` — `maplibre-yaml.Legend.Title`, `maplibre-yaml.Notice.Title`, `maplibre-yaml.Story.Chapters`, and so on — so one table translates MapLibre's zoom buttons and the legend, the "part of this map couldn't load" notice, error-card titles, the height hint, the params panel's notice, and a story's chapter rail, legend button and missing-image note. English stays the default and the only bundled language; the new "Accessibility & languages" guide lists every key. A misspelt `maplibre-yaml.*` key is reported by validation with a did-you-mean. The table is exported as `DEFAULT_STRINGS` / `createStrings()`, and `<ml-map>` gains `uiString(key)` so host chrome can use the document's text. Astro's `<FullPageMap>` labels its zoom and reset buttons from the same table (MapLibre's `NavigationControl.ZoomIn`/`ZoomOut` and `maplibre-yaml.FullPageMap.ResetView`).
