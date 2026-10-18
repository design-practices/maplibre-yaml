---
"@maplibre-yaml/cli": patch
---

`mlym preview` now renders on maplibre-gl 6, served from your own install instead of a CDN. The preview page used to load maplibre-gl 4 from unpkg and esm.sh, so it ran a different MapLibre than the docs recommend and showed a blank page offline. It now loads the maplibre-gl installed with `@maplibre-yaml/core` (and that core's browser bundle), including maplibre-gl 6's worker, so the preview matches the versions you installed and works without network access. If no maplibre-gl 6 is installed, the preview falls back to the maplibre-gl 6 CDN build and logs which one it used. Saving an edit to the YAML file now reloads the page as intended; the reload hook never fired before. Validation errors still appear in the page overlay.
