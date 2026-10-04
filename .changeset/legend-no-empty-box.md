---
"@maplibre-yaml/core": patch
---

A legend with no entries no longer renders an empty "Legend" box. Entries come from layers' `legend:` fields or the legend block's own `items:`; when neither exists, no box is shown and `<ml-map>` logs one warning naming what to add. `FullPageMap`'s `showLegend` also warns at build time when the document has no legend entries.
