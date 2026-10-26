---
"@maplibre-yaml/core": patch
---

`<ml-map>` and `<ml-scrollytelling>` now read an inline document from `<script type="application/json">` or `<script type="application/yaml">` (and `text/x-yaml`, `application/x-yaml`, `text/json`), not only `text/yaml`. Before, `<ml-map>` showed "No configuration provided" for those scripts even though its stylesheet already hid them, and `<ml-scrollytelling>` ignored JSON. JSON goes through the same parser as YAML, so errors keep their line numbers and did-you-mean hints, and a syntax error in a JSON script now reads "JSON syntax error". The documented order is unchanged (property, inline script, `src`, `config` attribute), so an `<ml-map>` that carries both a JSON script and a `config` attribute now renders the script. A document script inside slot content or a nested element is no longer mistaken for the map's own document.
