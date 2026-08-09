---
"@maplibre-yaml/core": minor
"@maplibre-yaml/astro": patch
---

Make the library's canonical YAML parse options a supported public export and
fix a live Astro `!html` parsing bug (ml-0fg, PR #74). `YAML_PARSE_OPTIONS` and
`htmlTag` are now exported (frozen) from `@maplibre-yaml/core` so a consumer that
parses YAML itself parses exactly as the library does instead of re-declaring
the options and drifting. The Astro loader carried its own drifted copy that had
`merge` but not the `!html` tag, so `label: !html "<b>Bold</b>"` resolved to the
`{ $html }` marker through core but to a bare string through Astro's
`loadYAML`/`loadFromGlob`; the loader now imports the canonical options and the
two read paths agree.
