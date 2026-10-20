---
"@maplibre-yaml/core": minor
---

Strings starting with `=` in style values are now warned about, as the format reserves them for a future expression shorthand. `text-field: "=upper({name})"` used to validate silently and draw the text as written; it now gets a positioned warning — in `mlym validate`, the browser console, and the on-page notice while developing — suggesting a MapLibre expression (`["upcase", ["get", "name"]]`). The check covers `paint:`, `layout:` and `filter:` values and story `setPaintProperty`/`setLayoutProperty` values, in format v1 and v2; prose is never checked, and MapLibre's `==` operator never warns. Text that really starts with `=` is written `["literal", "=…"]`, which never warns.
