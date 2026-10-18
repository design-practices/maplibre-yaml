---
"@maplibre-yaml/core": patch
---

Validation now warns about three mistakes that used to pass silently. A chapter's `layers.show` / `layers.hide` or an action's `layer:` that is a near miss of one of the story's layers (`walking` for `walk`, `place` for `places`) gets a did-you-mean; names unlike any document layer are left alone, since they may be basemap layers. A `fitTo.source` that names no source under `sources:` says the map will keep its center and zoom, and suggests the closest name. A source whose `url:` or `data:` is a CSV file (`data/places.csv`, a Google Sheets `output=csv` link) says CSV isn't supported and to convert it to GeoJSON.
