---
"@maplibre-yaml/core": patch
---

Validation now warns about keys that the schema accepts but nothing acts on. They are deprecated, and existing documents still validate. `fetchStrategy: build` and `fetchStrategy: hybrid` have no effect, because a source's data is always fetched in the browser when the map loads. A multi-page document's `config.dataFetching` and `config.theme` have no effect, because nothing reads them; a story's own `theme:` still works. Multi-page documents themselves (`pages:`, with `content`, `mixed` and `map-fullpage` blocks) validate, but no maplibre-yaml package renders them yet, so they get one warning per document. These warnings are deprecations, so `mlym validate --strict` still passes; `--strict-deprecations` turns them into errors. The JSON Schema and the generated YAML reference describe each of these keys as "No effect (deprecated)". Each one will be either implemented or removed in a later minor release.
