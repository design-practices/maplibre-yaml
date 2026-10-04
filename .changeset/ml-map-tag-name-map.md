---
"@maplibre-yaml/core": patch
---

`<ml-map>` is now known to TypeScript's DOM typings: importing
`@maplibre-yaml/core/register` declares `HTMLElementTagNameMap["ml-map"]` as
`MLMap`, so `document.querySelector("ml-map")` and
`document.createElement("ml-map")` come back typed, and `mapReady()` / `getMap()` type-check without an `as MLMap` cast.
Type-only; no runtime change.
