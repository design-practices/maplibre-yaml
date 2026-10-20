---
"@maplibre-yaml/core": patch
---

`hover.highlight: true` now works on a layer with `classify:`. The colour classify generates is wrapped in the same hover `feature-state` case as a plain colour, including after computed breaks arrive, so the hovered feature lights up. Before, the layer showed no highlight and the console warned that the colour was "already an expression". Your own paint expressions are still left alone, with the warning.
