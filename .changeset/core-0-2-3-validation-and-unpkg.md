---
"@maplibre-yaml/core": patch
---

Two fixes for documented usage patterns that were broken:

**Reject path-like strings in GeoJSON `source.data` with an actionable error.** Closes #32.

Writing `data: "./src/data/foo.geojson"` in a map YAML schema-validated fine but failed silently in deployed sites — MapLibre treats string `data` as a URL, and `src/` isn't served at runtime by Astro / most static frameworks, so layers 404 and the map renders only its basemap. The schema now rejects strings starting with `./`, `../`, `src/`, or `/src/` in `data:` at parse time with a message that points to `url:` and `public/`. Inline GeoJSON objects in `data:` and remote URLs in `data:` continue working unchanged.

**Add `register.js` at the package root so the documented unpkg URL works.** Closes #33.

Our published docs (vanilla-js, web-components, quick-start integration guides) recommend:

```html
<script type="module" src="https://unpkg.com/@maplibre-yaml/core/register"></script>
```

This URL returned 404 with no CORS headers because unpkg doesn't honor the package.json `exports` field for subpath resolution — it serves files at the literal path, and our `./register` export mapped to `./dist/register.js`. A thin top-level `register.js` re-exports `./dist/register.js` so the bare CDN URL now resolves with proper CORS. npm / Vite / Webpack consumers continue using the `exports`-field mapping and never touch this file.

After 0.2.3 ships, no doc changes are required — every documented `<script src="https://unpkg.com/@maplibre-yaml/core/register">` snippet starts working.
