---
"@maplibre-yaml/core": minor
---

GeoParquet and FlatGeobuf sources accept `load: { overviews: false }` (experimental), in v1 documents and under a v2 source's `runtime:`, and the key is in the JSON Schema. It is the switch for GeoParquet overview files (`geo:overviews`): read by view, they are set to draw the level that fits the zoom, and `overviews: false` keeps 0.9.2's full-detail level only. On a FlatGeobuf source the key warns that it does nothing; a value that isn't `true` or `false` is an error. A source key of the wrong type, such as `load: { maxFeatures: lots }`, is now reported at that key (`sources.lots.load.maxFeatures`) rather than at the source.
