---
"@maplibre-yaml/core": minor
"@maplibre-yaml/astro": minor
---

The on-page notice now separates what failed from hints for the author. Failures (a data file that didn't load, a layer MapLibre rejected) always show, as before: one plain line for visitors with the fix under "Details for the site's author". Author hints — did-you-mean suggestions, keys nested under `config:`, a `fitTo` typo, coordinates that look written [latitude, longitude], a chapter naming a missing layer, a value starting with the reserved `=` — now show only while you develop: on `localhost`/`127.0.0.1`/`[::1]`/`file:` pages and in bundler dev builds (`astro dev`, `vite`), so visitors to a published site no longer see them. A new `debug` attribute on `<ml-map>` and `<ml-scrollytelling>` (and `debug` prop on the Astro `Map`, `FullPageMap` and `Scrollytelling` components) shows them anywhere, for checking a deploy; `quiet` still hides everything, and the console keeps every hint. A notice holding only hints reads "Notes for this map's author". `showAuthorHints()` / `authorHintsDecision()` (from `@maplibre-yaml/core/components`) expose the rule.
