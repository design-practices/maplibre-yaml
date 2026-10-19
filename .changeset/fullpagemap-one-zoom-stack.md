---
"@maplibre-yaml/astro": patch
---

`FullPageMap` no longer shows two stacks of zoom buttons when the document declares its own navigation control. A YAML with `controls: { navigation: true }` already puts MapLibre's +/− in the top-right corner, and FullPageMap's own +/− appeared again under it, which looked like a bug. FullPageMap now keeps only its reset button in that case (checked on every load, so a `reload()` or new config is handled too); documents without a navigation control still get zoom in, zoom out and reset.
