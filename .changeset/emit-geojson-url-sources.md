---
"@maplibre-yaml/core": patch
"@maplibre-yaml/cli": patch
---

`mlym emit` (and core's `projectStyle`) now writes a GeoJSON source given by `url:` the way the MapLibre style spec expects it, as `data: <url>`, for named sources and for inline sources on a layer. Before, the source was copied as `{type: geojson, url: …}`, and maplibre-gl rejected the whole emitted style over the unknown `url` property. Because the emitted source now loads its URL, a live `url:` source (`refresh:`, `stream:`) is reported as a `contract` warning (the live updates don't carry over) instead of `lossy`, so `--strict` accepts it.
