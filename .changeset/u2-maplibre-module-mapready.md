---
"@maplibre-yaml/core": minor
---

Two new routes for page JavaScript. `@maplibre-yaml/core/maplibre`
re-exports the maplibre-gl module core renders with — `addProtocol` (pmtiles,
COG, custom schemes) finally registers on the module instance the document's
requests actually go through, instead of a copy the map never consults. The
subpath re-exports named runtime values off the interop-resolved namespace, so
it works under real Node ESM where `export * from "maplibre-gl"` silently
loses every named export. And `<ml-map>` gains `mapReady(): Promise<Map>` —
resolves with the live map once loaded (immediately if already loaded),
rejects on `ml-map:error` — replacing the load-listener + `getMap()`
null-guard boilerplate in every page-code snippet.
