---
"@maplibre-yaml/core": minor
---

A vector source on a PMTiles archive of MLT tiles (MapLibre Tiles, tile type 6 in the archive header) now draws without `encoding: mlt` in the YAML: core reads the header and sets the encoding on maplibre-gl 6 and later, the first version that draws MLT. An `encoding:` the author writes still wins, and `encoding` (`mvt` or `mlt`) is now a documented vector-source key in the schema and the JSON Schema. When MLT tiles fail because of 64-bit integer columns, which MapLibre decodes as BigInt and can't pass on, the map shows one notice per source naming the cause and the fixes (write those columns as doubles or strings, or build MVT tiles) instead of an error for every tile. Below maplibre-gl 6, an MLT archive gets one author note naming the version it needs. A page that registers its own `pmtiles` protocol keeps its handler and gets no automatic encoding.
