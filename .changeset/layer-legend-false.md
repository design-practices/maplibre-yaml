---
"@maplibre-yaml/core": patch
---

A layer can now say `legend: false` to stay out of the legend; on a classified layer this also leaves out its generated classes. Before, `legend: false` on a layer stopped the whole map or story with "Expected object, got boolean". It works in v1 maps, stories and a v2 layer's `runtime:`. When every classified layer opts out, no automatic legend is added.
