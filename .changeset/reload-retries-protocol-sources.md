---
"@maplibre-yaml/core": patch
---

`reload()` now retries a `pmtiles://` or `cog://` source whose reader file (`chunks/pmtiles.js`, `chunks/cog.js`) couldn't be downloaded — offline, a content blocker, a self-hosted copy without `chunks/` — and likewise any tile or image source whose TileJSON or image request failed: its url is set again, the reader is fetched anew, the source draws, and its notice line goes once it loads. Before, such a source was not counted among the sources whose last load failed, so `reload()` saw an unchanged document, asked for nothing, and the source stayed blank. Failed individual tiles (an ordinary 404) are still not retried this way. The renderer also emits a new `source:retried` event when such a source loads on a later try.
