---
"@maplibre-yaml/core": patch
---

`fitTo: tracts` (just the source name) now works as shorthand for `fitTo: { source: tracts }`. Before, it stopped the map with "Expected object, got string". A misspelt name in the shorthand gets the same did-you-mean warning as the object form.
