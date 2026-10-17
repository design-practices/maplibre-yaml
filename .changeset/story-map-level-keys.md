---
"@maplibre-yaml/core": minor
---

A scrollytelling story now takes every map-level key a `type: map` document does — `sources:`, `markers:`, `legend:`, `state:` and `parameters:` (the params panel), `popups:`, `images:`, `controls:`, `terrain:`, `sky:`, `projection:`, `light:` — validated with the same schema and passed to the story's map. Before, a story's map was `config:` + `layers:` only and these keys were rejected as unknown, so layers could not share a named source and a story could have no legend or markers.
