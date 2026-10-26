---
"@maplibre-yaml/core": patch
---

A GeoParquet overview file — one written by tylertoo, which stores a simplified copy of the data per zoom level as extra rows listed in its `geo:overviews` footer key — now draws each feature once. Before, every level's rows were read, so a map drew several overlaid copies of each feature (a 600-lot test file reads as 1,732 rows), counted them all against the size limits, and computed `classify` breaks and `mlym emit`'s inlined data over the duplicates. Whole-file reads, reads by view, the size guards, `classify` and `mlym emit` now read only the file's full-detail (canonical) level. A file whose `geo:overviews` version is newer than this release understands is read the same way, with a note to the author. Choosing a coarser level for the map's zoom is planned for 0.10.
