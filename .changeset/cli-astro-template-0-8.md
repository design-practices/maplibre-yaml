---
"@maplibre-yaml/cli": patch
---

`init --template astro` now scaffolds a current site: Astro 7 with `@maplibre-yaml/astro`'s `<Map>` component (instead of a hand-wired `<ml-map>`), `@maplibre-yaml/core` 0.8 and `@maplibre-yaml/astro` 0.6, a layout with the viewport meta tag so maps fit on phones, the optional `@maplibre-yaml/astro/integration`, commented `site`/`base` lines for GitHub Pages, a ready-to-use `.github/workflows/deploy.yml`, a `.gitignore`, and `npm run check`. A fresh scaffold installs with no `npm audit` findings (the old one pulled core 0.7 and an Astro 5 with a critical advisory). The core and astro version ranges are now taken from the packages the CLI was released with, so they no longer fall behind.
