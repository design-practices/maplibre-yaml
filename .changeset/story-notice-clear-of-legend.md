---
"@maplibre-yaml/core": patch
---

On a phone, a story's pinned legend no longer covers the map's notice ("Part of this map couldn't load", and the author notes while you develop). When the legend button or its open panel reaches into the notice's place at the top of the map, the notice moves beside the legend or, without room, below it. A page can position the notice itself through the `--ml-map-notice-top`, `--ml-map-notice-left`, `--ml-map-notice-transform` and `--ml-map-notice-max-width` custom properties.
