---
"@maplibre-yaml/core": patch
---

The console no longer blames your YAML for icons the basemap is missing. On OpenFreeMap Liberty at street zoom, every map logged `[maplibre-yaml] layer references image "office" but no images: entry, sprite, or addImage call supplies it.` for POI icons the basemap's own sprite lacks (`office`, `running`, `swimming_pool` …), which a student could do nothing about. That warning now appears only for image names your document uses: in its layers (`icon-image`, `*-pattern`, including every branch of `match`/`case`/`step`/`coalesce`) and in a story's `setLayoutProperty`/`setPaintProperty` chapter actions. If a layer builds its icon name from feature data (an expression or a legacy `"{icon}-15"` token string), a missing name gets a softer note that says it may be a basemap icon. `MapRenderer` gains `noteImageReference(property, value)` for names a page sets at runtime.
