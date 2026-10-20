---
"@maplibre-yaml/core": minor
---

`fitTo` on a `url:` source now opens already framed, with no jump. `<ml-map>` starts fetching the file as soon as it reads the document and builds the map with the data's bounds, so the first frame is on the data instead of the authored `center`/`zoom` followed by a jump (and a second set of basemap tiles). The file is still requested once — the map's source reuses the same download and the source's `cache:` settings — and `base` applies as before. Story maps and the Astro components get the same. If the file takes longer than 1.5 seconds the map is built at `center`/`zoom` and frames the data when it lands, as in 0.8; `MLMap.fitToWaitMs` changes the wait (`0` turns it off). For hosts that build a `MapRenderer` themselves, the new `sourceData` option hands over a load already in flight.
