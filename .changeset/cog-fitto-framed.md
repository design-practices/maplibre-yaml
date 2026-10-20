---
"@maplibre-yaml/core": patch
---

`fitTo` on a Cloud Optimized GeoTIFF (COG) now opens already framed, like a GeoJSON, FlatGeobuf or GeoParquet source. `<ml-map>` reads the file's header while the page starts — within the same `fitTo` wait (`MLMap.fitToWaitMs`, 1.5 seconds) — and builds the map on the image's extent, instead of drawing the authored `center`/`zoom` first and jumping once the imagery arrived. The COG reader reuses that read, so the file is not requested an extra time.
