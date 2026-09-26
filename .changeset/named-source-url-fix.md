---
"@maplibre-yaml/core": patch
---

Block-level named `sources:` entries with `url:` now actually load under the
renderer. Previously the YAML-only `url` key was passed straight through to
MapLibre's `addSource` — whose geojson sources take `data`, not `url` — so
style validation threw and the *entire* document render silently aborted:
no sources, no layers, an empty basemap. Named url sources now route through
the same DataFetcher path as inline layer sources (initial empty data added
synchronously so referencing layers can attach, the fetch resolving into
`setData`, caching honored, and `layer-data-loading/loaded/error` events
fired with the source id as their subject, matching the refresh pipeline).
Inline sources and named sources with inline `data:` were unaffected.
