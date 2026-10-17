---
"@maplibre-yaml/core": patch
---

Astro (and other bundled) sites on maplibre-gl 6 no longer show blank maps when `@maplibre-yaml/core/register` ends up in a shared chunk. A bundler may evaluate `register` before the code that sets maplibre-gl 6's worker URL, and `<ml-map>` used to build its map in that moment, so every map on the site failed with "Worker failed to load". `<ml-map>` now waits until the page's module and deferred scripts have run (DOMContentLoaded) before it constructs the map; elements created after that, and maplibre-gl 4/5, behave as before. `mapReady()` simply resolves a little later. A map whose worker still cannot load now replaces itself with an on-page "Map Error" card that says how to call `setWorkerUrl()`, and `mapReady()` rejects, instead of leaving an empty box with the explanation only on the console.
