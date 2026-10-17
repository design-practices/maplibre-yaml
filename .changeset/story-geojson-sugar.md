---
"@maplibre-yaml/core": patch
---

GeoJSON sugar (`location:`, `locations:`, `region:`, `route:` on a `type: geojson` source) now works in scrollytelling stories, on layer sources and in a story's `sources:`, wherever a story is parsed: `parseScrollytellingBlock`/`safeParseScrollytellingBlock`, the new `safeParseScrollytellingBlockValue` (for a story object), and stories inside a `pages:` document. Before, it failed with "GeoJSON source requires at least one of: url, data, or prefetchedData".
