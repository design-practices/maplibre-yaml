---
"@maplibre-yaml/core": patch
---

A layer whose `before:` names a layer the map doesn't have — a typo such as `before: places_subplaces`, or a layer id from a different basemap — is now drawn on top of the map instead of being dropped. Before, MapLibre refused the layer and the data disappeared with only a console error. While you develop, the map's author notes say what happened and suggest the closest layer id from the document or the basemap. A story chapter that names a missing layer now also gets suggestions from the basemap's layer ids.
