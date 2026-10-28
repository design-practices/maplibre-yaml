---
"@maplibre-yaml/astro": minor
---

`Map` and `FullPageMap` accept `id` and `camera` props, and `FullPageMap` follows in-place document updates. `id` lands on the rendered `<ml-map>` in place of the generated one, so a page script can reach the element (`document.getElementById(id).update(doc)`, `getMap()`, `getState()`, or listen for `ml-map:update-applied`); `camera="host"` passes through as the element's `camera` attribute for pages whose viewport is per-user, so a changed document never moves the map. With core 0.10 a changed `config` or `src` is applied in place instead of rebuilding the map, so `FullPageMap`'s reset button now re-captures its home camera when an update moves the camera (after the ease settles), and its zoom buttons re-sync with the document's own navigation control on every applied update, in-place or rebuilt — one set of zoom buttons either way. Accordingly, `@maplibre-yaml/astro` 0.8 now requires `@maplibre-yaml/core` 0.10 or later.
