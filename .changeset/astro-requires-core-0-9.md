---
"@maplibre-yaml/astro": patch
---

`@maplibre-yaml/astro` now declares `@maplibre-yaml/core >=0.9.0` as its peer (was `>=0.8.0`). The components pass 0.9 options straight to core — the `debug` prop, a Protomaps `mapStyle: { pmtiles, flavor }` in the map builders, translated FullPageMap buttons — which core 0.8 ignores or rejects. Upgrade both packages together: `npm install @maplibre-yaml/astro@latest @maplibre-yaml/core@latest`.
