---
"@maplibre-yaml/core": minor
"@maplibre-yaml/cli": minor
---

Parse format-v2 documents into the internal model (ml-dsu, PR #72). A second
parser front end reads a `version: 2` document — the explicit `style:` /
`runtime:` split, per-source and per-layer `runtime:` blocks, and the v2 renames
(`basemap`, root-level camera, `runtime.container.style`) — into the same
`MapModel` a v1 document produces. A `toModel(result)` dispatcher selects the v1
or v2 front end by the detected version, so the renderer, emitter, and extension
registry are untouched: a v2 document is indistinguishable from its v1 twin
downstream (AE2). Inline `source.data` is now validated as real RFC 7946 GeoJSON
(a hard error under v2, still lenient under v1). `mlym validate` accepts and
strictly validates v2 documents through the same path.
