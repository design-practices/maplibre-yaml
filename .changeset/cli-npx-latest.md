---
"@maplibre-yaml/cli": patch
---

`init` now prints its follow-up commands as `npx maplibre-yaml@latest …` (for example `npx maplibre-yaml@latest validate map.yaml`), and the `story` template's comment uses the same spelling. Without `@latest`, npx can silently reuse an older CLI it cached on an earlier run, so a reader following the printed steps could validate against an out-of-date schema.
