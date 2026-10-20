---
"@maplibre-yaml/core": minor
"@maplibre-yaml/cli": patch
---

The CDN build now loads format readers on demand, from files next to `register.js`. The PMTiles, FlatGeobuf and COG readers are not inside `dist/register.browser.js` (about 161 KB gzip); they are separate files, `dist/chunks/pmtiles.js` (about 8 KB gzip), `dist/chunks/flatgeobuf.js` (about 12 KB) and `dist/chunks/cog.js` (about 131 KB, its heavier image codecs in `dist/chunks/cog-*.js`), which the browser fetches relative to the script only when a map uses that format. A page without such a map downloads nothing extra. Loading from unpkg or jsDelivr needs no change. If you host maplibre-yaml yourself, copy the whole `dist/` folder rather than a single file: when a reader can't be downloaded (a missing file, offline, a content blocker), the map's notice names the file and says what to do, and every other layer still draws. The npm build splits the same way (`dist/formats/`, with shared code in `dist/shared/`), so Vite, Astro and webpack apps get the readers as lazy chunks of their own build; Node use (`mlym emit`, server rendering) works as before. `mlym preview` serves the reader files next to the bundle.
