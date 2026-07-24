---
"@maplibre-yaml/core": patch
---

Minify the browser/CDN bundle. `register.browser.js` (served raw from unpkg for the zero-build `<script type="module">` path) was shipping unminified; the tsup browser pass now runs with `minify: true`, substantially shrinking the payload with no API or behavior change.
