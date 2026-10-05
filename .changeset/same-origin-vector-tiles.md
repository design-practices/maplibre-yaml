---
"@maplibre-yaml/core": patch
---

Fix: vector sources with same-origin tile paths (`tiles: ["/tiles/{z}/{x}/{y}.pbf"]`) now render. The schema has accepted such paths, but MapLibre fetches vector tiles inside its web worker, where a relative URL cannot resolve, so the map silently drew nothing. Core now resolves the template against the page before handing it to MapLibre and keeps the `{z}/{x}/{y}` placeholders intact.
