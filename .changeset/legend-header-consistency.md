---
"@maplibre-yaml/core": minor
---

Behaviour change for plain-map legends: the legend's collapsible header now always reads "Legend" (or its translation, `maplibre-yaml.Legend.Title`), matching story legends, and a custom `legend.title` is shown as a heading inside the panel instead of replacing the header. A title of "Legend", or none, adds no heading. Documents need no change; a screen reader now announces every legend the same way ("Legend, expanded"). CSS that styled `.legend-title` as the author's title should target the new `.legend-heading`.
