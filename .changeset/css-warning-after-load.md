---
"@maplibre-yaml/core": patch
---

The "MapLibre GL CSS does not appear to be loaded" console warning no longer fires on every map under `astro dev` (or with an asynchronously loaded stylesheet). The check now runs once the map has loaded, waits for stylesheets that are still loading, and looks in the element's own document, so it only warns when the CSS is really missing. The warning now suggests importing the stylesheet from the installed maplibre-gl package, or a CDN URL pinned to the same version.
