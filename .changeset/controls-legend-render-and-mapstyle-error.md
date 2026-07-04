---
"@maplibre-yaml/core": patch
---

`controls:` and `legend:` blocks now render in `<ml-map>`; missing `mapStyle` shows a helpful error instead of a MapLibre crash.

**`controls:` and `legend:` actually render.** `MapRenderer` constructed `ControlsManager`/`LegendBuilder` but never invoked them, and `<ml-map>` dropped both keys when extracting the parsed block — so YAML that validated cleanly rendered nothing. `<ml-map>` now threads `controls` and `legend` through to `MapRenderer`, which applies them on map `load` (the same lifecycle point layers use). The legend renders into a positioned `.ml-map-legend` container inside the map element. Manual `addControls()`/`buildLegend()` calls still work and are guarded against double-application.

**Missing `mapStyle` gets a friendly error card.** `mapStyle` is schema-optional because the Astro builders resolve it from `globalConfig.defaultMapStyle`, but a standalone `<ml-map>` has no global config — an omitted `mapStyle` passed validation and died inside MapLibre with an opaque runtime error. `<ml-map>` now surfaces the existing error card stating that `mapStyle` is required for standalone maps, with a copy-pasteable example and a note that `defaultMapStyle` inheritance is an Astro-builder feature.
