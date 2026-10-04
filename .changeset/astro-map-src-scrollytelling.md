---
"@maplibre-yaml/astro": patch
---

`<Map src>` and `<Scrollytelling config>` now work in a real browser. Before, `<Map src>` never loaded: its inline loader imported `@maplibre-yaml/core` by a bare specifier that browsers cannot resolve, so the map showed "No configuration provided". `Map` now passes `src` straight to `<ml-map src>`, which fetches, validates and shows its own error card. `Scrollytelling` with `config` never drove the map: it waited for a `config` attribute it only set afterwards, read a `.map` property `<ml-map>` does not have, and would have set an invalid document. It now renders the story's map onto `<ml-map>` and waits on `mapReady()`. Chapters now overlay the sticky map. Before, the mouse wheel zoomed the map instead of scrolling the story, links and videos inside chapters could not be clicked, and `debug` outlines never showed. Scrollytelling's `src` mode is still broken (tracked separately).
