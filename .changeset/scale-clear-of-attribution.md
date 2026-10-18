---
"@maplibre-yaml/core": patch
---

On phone-width maps, the scale bar (`controls: { scale: true }`) is no longer hidden under MapLibre's attribution text. MapLibre opens its compact attribution expanded across the bottom edge until the first drag; 0.8.0 started it collapsed only when a legend or slot sat in the bottom-left corner. Any MapLibre control in that corner, such as the scale bar, now counts too. The (i) button still opens the attribution.
