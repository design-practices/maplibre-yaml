---
"@maplibre-yaml/astro": patch
---

Content-collection entries validated with `getMapSchema()` or `getScrollytellingSchema()` now accept the GeoJSON shorthand (`location:`, `locations:`, `region:`, `route:` on a `type: geojson` source), just as `<Map src>` and `loadMapConfig` do. Before, the same YAML that worked as a map file failed as a collection entry with "GeoJSON source requires at least one of: url, data, or prefetchedData". The entry's data now has the shorthand expanded into `data:`, and a malformed shorthand is reported at its own path. `extendSchema()` keeps this behavior. Both helpers are now always a validating wrapper, never core's zod object itself; on Astro 6 and 7 they already were.
