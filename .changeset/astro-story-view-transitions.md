---
"@maplibre-yaml/astro": patch
---

`Scrollytelling` works with `<ClientRouter />` soft navigations: MapLibre's stylesheet is now page CSS (imported in the component, as `Map` and `FullPageMap` do), so it survives the head swap in `astro dev`, and each visit to a story page gets a fresh story whose map is disposed of when you navigate away, with the chapter rail working on every visit. A standalone `Chapter` now renders active (full opacity) by default instead of dimmed; pass `isActive={false}` for the inactive look.
