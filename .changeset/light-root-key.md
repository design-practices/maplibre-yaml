---
"@maplibre-yaml/core": minor
---

New `light:` document key: the style-spec root light that shades `fill-extrusion` faces (`anchor`, `position`, `color`, `intensity`, each also accepting a zoom expression). It sits at the document root in v1 and in the `style:` half in v2. Live, it is applied with `map.setLight`. On export it compiles verbatim to the emitted style's `light`, replacing any basemap light, under the export class `exports`. The object is closed, so a misspelled key is a validation error rather than a silently ignored setting.
