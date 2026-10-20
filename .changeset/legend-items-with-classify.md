---
"@maplibre-yaml/core": patch
---

A legend block with its own `items:` no longer hides the classes of a classified layer. The legend now lists the items first and the generated classes after them. `mlym validate`, and the author notes on a page under development, point out the combination: hand-written items next to `classify:` usually describe the layer's colours from before it was classified. Write `legend: false` on a layer to leave its classes out of the legend.
