---
"@maplibre-yaml/core": patch
---

Several schema descriptions were wrong, and they are now corrected. Editors show these descriptions from the JSON Schema, and the generated YAML reference prints them. `showMarkers` turns on the chapter rail beside the story; it does not put markers on the map. `fitTo.source` can name any source the camera can frame, which is GeoJSON, FlatGeobuf, GeoParquet or COG, not only GeoJSON. A `params:` entry whose `type` isn't recognized shows a read-only row with the parameter's current value instead of rendering nothing. The flat `refreshInterval`, `updateStrategy` and `updateKey` on a GeoJSON source are now described as deprecated in favor of the `refresh:` block, which validation already warned about.
