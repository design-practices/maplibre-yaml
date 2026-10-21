---
"@maplibre-yaml/core": patch
---

Validation (and `mlym validate`) now warns when a map has no basemap (`config.mapStyle` in v1, `style.basemap` in v2). `<ml-map>` refuses such a map with an error card, so the warning brings validation in line with what the page shows. It is a warning, not an error, because the Astro builders can fill the basemap in from a site-wide `defaultMapStyle`.
