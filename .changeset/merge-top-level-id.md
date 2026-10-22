---
"@maplibre-yaml/core": patch
---

Live-data `updateStrategy: merge` no longer empties the map when features lack the `updateKey` property. A feature without `properties[updateKey]` is now matched by its top-level GeoJSON `id`, so feeds that keep their id outside `properties` (the USGS earthquake feeds, for one) update in place with `updateKey: id` instead of dropping every feature on the first poll. Features with neither are kept rather than dropped: each update's keyless features replace the previous update's (so a re-polled feed doesn't pile up copies), and the source warns once, in the console and in the map's author notes while developing, naming the source, the key, and some of the properties the data does have. `MergeResult` gains an optional `unkeyed` count.
