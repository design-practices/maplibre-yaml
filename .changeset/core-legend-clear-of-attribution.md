---
"@maplibre-yaml/core": patch
---

A bottom-left legend (or other bottom-left chrome) is readable on phones again. On narrow maps MapLibre opens its compact attribution expanded until the first drag, and it spread across the bottom of the map over the legend, so only the legend's title showed. When the bottom-left corner holds a legend, parameters panel or slot, the attribution now starts collapsed to its (i) button, as MapLibre leaves it after a drag. Tapping the button still opens it.
