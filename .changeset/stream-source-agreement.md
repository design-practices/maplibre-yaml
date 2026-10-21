---
"@maplibre-yaml/core": patch
---

Streamed GeoJSON sources now get validation advice that matches what the map does. A source with only `stream:` is still refused, and the error now says how to start empty (`data: { type: FeatureCollection, features: [] }`). A `stream:` without a `refresh:` block now gets a warning, because the stream only connects when `refresh:` (or the legacy `refreshInterval:`) is next to it. Before, such a source validated cleanly and never connected.
