---
"@maplibre-yaml/core": patch
"@maplibre-yaml/astro": patch
---

README corrections: fix the core JavaScript API example to use `YAMLParser.parseMapBlock` and the real `MapRenderer` constructor signature (`container, config, layers, options, sources`), replace the fictional `interactions:`/HTML-string popup format with the actual `interactive.click.popup` tag-array DSL, and fix the astro README scrollytelling example to use flat chapter `center`/`zoom` (matching `ChapterSchema`) instead of a nested `location:` object. Source `url` examples now use absolute URLs, which is what the schema validates.
