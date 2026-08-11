---
"@maplibre-yaml/astro": patch
---

Fix the Astro loader's `!html` handling by importing core's canonical
`YAML_PARSE_OPTIONS` (ml-0fg, PR #74). The loader carried a drifted copy of the
parse options that had `merge` but not the `!html` tag, so `label: !html "<b>Bold</b>"`
resolved to the `{ $html }` marker through core but to a bare string through
Astro's `loadYAML`/`loadFromGlob`; the loader now imports the canonical options
and the two read paths agree.
