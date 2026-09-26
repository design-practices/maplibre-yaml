---
"@maplibre-yaml/core": patch
---

Valid style-spec paint/layout keys outside the curated schema shapes no
longer produce "unknown key" warnings — and therefore no longer fail
`mlym validate --strict` (the CI default). The warning walker now consults
key inventories generated from `@maplibre/maplibre-gl-style-spec` (v5-era
keys like `hillshade-method`, `text-variable-anchor-offset`, and
`visibility` on any layer's `layout` included), so correct documents stop
erroring while typos still warn — with did-you-mean hints now drawn from
the full spec pool, not just the curated subset. The generated inventory is
pinned to the installed spec package by a unit test, so it cannot silently
drift again.
