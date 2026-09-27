---
"@maplibre-yaml/astro": patch
---

`buildPolygonMapConfig` (and everything built on its region layers) now
renders its outline. The `region-outline` layer referenced `"region-fill"`
as its source — a *layer* id, not a source name (the renderer names a
layer's inline source `<layerId>-source`), so the reference resolved
against nothing and the outline silently never drew. Both layers now carry
their own inline source. Found by the astro release-gate smoke the moment
renderer errors became loud.
