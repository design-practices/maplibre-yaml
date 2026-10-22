---
"@maplibre-yaml/effects": patch
---

Effects no longer flicker for a few frames while you zoom across a tile level on maplibre-gl 6. During the transition MapLibre briefly keeps a parent tile on screen next to its newly loaded children, and the extrusions backend drew the buildings from both, so for a few frames effects such as `tonal-hatch` and `blueprint` showed doubled outlines and mixed hatching. Each area is now drawn from one tile level only, matching what MapLibre's own fill layers show: the children where they cover the whole parent, the parent until they do.
