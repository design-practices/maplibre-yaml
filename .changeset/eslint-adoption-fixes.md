---
"@maplibre-yaml/cli": patch
"@maplibre-yaml/core": patch
---

`mlym preview` and `mlym validate --watch` no longer crash with an unhandled rejection when stopping the dev server or file watcher fails on Ctrl-C: the error is logged and the command exits 4. In core, `MapRenderer.off(event, callback)` now takes the same typed callback as `on()` instead of any `Function`; passing `off()` the callback you gave `on()` compiles as before.
