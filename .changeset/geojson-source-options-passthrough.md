---
"@maplibre-yaml/core": patch
---

Inline and url-fetched GeoJSON layer sources now forward `lineMetrics`,
`tolerance`, `buffer`, `maxzoom`, and `attribution` (and the url path also
`generateId`/`promoteId`) to MapLibre. The renderer built these source
specs from a hand-picked field list, so schema-accepted options were
silently dropped — most visibly, `line-gradient` never rendered because its
source lost `lineMetrics`. Found by the gallery gradient-line pages.
