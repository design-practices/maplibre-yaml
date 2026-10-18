---
"@maplibre-yaml/core": patch
---

The console no longer blames your YAML for icons the basemap is missing. On OpenFreeMap Liberty at street zoom, every map logged `[maplibre-yaml] layer references image "office" but no images: entry, sprite, or addImage call supplies it.` for POI icons the basemap's own sprite lacks (`office`, `running`, `swimming_pool` …), which a student could do nothing about. That warning now appears only for image names your document's layers use (`icon-image`, `*-pattern`, including every branch of `match`/`case`/`step`/`coalesce`). If a layer builds its icon name from feature data, a missing name gets a softer note that says it may be a basemap icon.
