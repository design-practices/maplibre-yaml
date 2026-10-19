---
"@maplibre-yaml/core": patch
---

A `center:` written latitude first is now flagged. `center: [40.75, -73.98]` (the order map sites show) used to validate and open a blank map thousands of kilometres from the data. When the swapped pair lands on the document's own data, markers or other centers and the written pair is far from all of them, validation and the map's notice now say `center is [40.75, -73.98] — coordinates are [longitude, latitude]; did you mean [-73.98, 40.75]?`. The same applies to a story chapter's `center:`. A latitude beyond about ±85, which a web map can't show, warns too. Places that are simply far apart (a world tour, or one chapter on another continent) are not flagged.
