---
"@maplibre-yaml/core": patch
---

A map with no height is now always flagged, including when `<ml-map>` has slot children. Before, a slot child such as `<div slot="bottom-left">` gave the element a little height while the check ran, so a map that was invisible gave no warning at all. The check now runs once the map has loaded and measures the map itself. Besides the console warning, the element shows a short note on the page saying to give it a height, for example `<ml-map style="display:block; height:400px">`. The note removes itself once the map has a height, and the `quiet` attribute turns it off.
