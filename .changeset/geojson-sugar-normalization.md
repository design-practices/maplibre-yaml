---
"@maplibre-yaml/core": minor
---

Add GeoJSON authoring sugar (`location`, `locations`, `region`, `route`) on
`type: geojson` sources. A source may carry one of these in place of `data:`/
`url:`, and it expands to a `Feature`/`FeatureCollection` immediately after
parse — format-wide (v1 and v2, standalone map blocks and multi-page
documents), so a sugar document renders through `<ml-map>` and normalizes
identically in both formats. The expander is exported from `@maplibre-yaml/core`
(`expandGeoSugar`, `project`, `detectSugarKey`, `SUGAR_KEYS`) so
`@maplibre-yaml/astro`'s builders share the same base-Feature shape. Malformed
sugar reports a clear error re-anchored to the authored sugar key rather than a
synthesized `data.*` path.
