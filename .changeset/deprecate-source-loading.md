---
"@maplibre-yaml/core": patch
---

A source's `loading:` block is now deprecated, because it never did anything. No per-source loading overlay was ever drawn. It still validates, so existing documents keep working, but validation now warns that `"loading:" has no effect`. The warning is a deprecation, so `mlym validate --strict` does not fail on it. You can remove the block. While a map starts, `<ml-map>` already shows "Loading map…" (and sets `aria-busy`), and a data file that fails to load is reported in the notice on the map. The JSON Schema describes the keys as deprecated, so editors say so too.
