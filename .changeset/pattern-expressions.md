---
"@maplibre-yaml/core": patch
---

`fill-pattern`, `line-pattern`, `fill-extrusion-pattern` and `background-pattern` now accept expressions, as the style spec allows. A data-driven pattern such as `fill-pattern: [match, [get, class], sand, earth, landuse]` used to fail validation; it now validates, renders, and ejects cleanly. Every literal output is rewritten into the document sprite. Emit also no longer warns that such a pattern "computes image names from data" just because its `match` input reads a feature property. Only a name computed at an output position still warns.
