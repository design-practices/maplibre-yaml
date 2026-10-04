---
"@maplibre-yaml/core": patch
---

Popups now open above the map's corner chrome (the legend, the params panel, slot content) and above MapLibre's own control corners. Previously a click, hover, marker or standalone popup opened near a corner panel rendered underneath it and could be half hidden. Markers stay below the chrome as map content.
