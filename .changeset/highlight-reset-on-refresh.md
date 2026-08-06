---
"@maplibre-yaml/core": patch
---

Clear `hover.highlight` when a layer's data is replaced.

Feature-state is keyed by feature id and survives `setData`, but ids are only meaningful within a single dataset — MapLibre's generated ids in particular are reassigned on every load. A highlight id retained across a refresh therefore lit up whichever feature happened to inherit that id, which is a different feature.

Both paths that replace data now drop the tracked highlight first: the polling/stream refresh, and the public `updateLayerData`. The next pointer movement re-applies the highlight under the cursor.
