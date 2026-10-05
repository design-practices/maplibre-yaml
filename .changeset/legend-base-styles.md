---
"@maplibre-yaml/core": patch
---

The built-in legend now looks like a legend. Core ships no stylesheet, so the legend used to render as bare text on the map, and every colour swatch was an empty 0×0 element. Swatches now have a size and a shape (circle, square or line), and the legend sits in the same white panel as the parameters panel. The styles are inline, like the parameters panel's, so there is nothing extra to load. To replace the legend's look entirely, use `<ml-map>`'s `slot="legend"`.
