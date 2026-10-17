---
"@maplibre-yaml/astro": patch
---

`loadMapConfig`, `loadScrollytellingConfig` and `loadFromGlob` validation errors now say where the problem is. The `astro dev` error overlay used to show only "Expected array, got undefined" with an empty stack; it now shows the file, the failing field with its line and column, and any parser warning on the same object, for example `./src/stories/trip.yaml: chapters.2.center: Expected array, got undefined (line 78, column 5). Warning: chapters.2.centre: Unknown key "centre". Did you mean "center"?`, with a code frame of the YAML line (Astro 4–7). `astro build` prints every error and warning. Each entry of `YAMLLoadError.errors` now carries that self-describing `message`; its `path`, `line` and `column` are unchanged, core's original wording is in the new `reason` field, and the entry type is exported as `YAMLLoadIssue`.
