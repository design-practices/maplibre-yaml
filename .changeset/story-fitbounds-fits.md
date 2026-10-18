---
"@maplibre-yaml/core": patch
---

A chapter's `fitBounds` action now always frames its bounds, even under a tall centred card. The card's camera offset and the action's own `padding` were added together, so with `padding: 100` under a centred card the total could be taller than the map: MapLibre refused ("Map cannot fit within canvas") and the camera stayed put. The card offset is now reduced as needed so the bounds always get at least a fifth of the map.
