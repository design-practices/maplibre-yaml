---
"@maplibre-yaml/core": patch
---

`background` layers now render under `<ml-map>`. The renderer
unconditionally resolved a source for every layer, but background layers
are sourceless by spec — so a schema-valid (and correctly emitting)
background layer threw during source resolution and took the whole
document down with it. Background layers now skip source resolution
entirely, and removing one no longer touches any source. Found by the
examples-gallery capability census.
