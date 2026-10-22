---
"@maplibre-yaml/cli": patch
"@maplibre-yaml/core": patch
---

When `mlym emit --strict` refuses a document because a construct such as `markers` or `fitTo` needs a fallback, the message now says to export without `--strict`, which applies the fallback and prints a warning. Before, it said to re-run with `--with-fallbacks`, which is already the default and is an error next to `--strict`. The message comes from core's `projectStyle`: in its default `with-fallbacks` mode, called without the fallback step, it now names the step to run first (`lowerMarkers`, `lowerFitTo`).
