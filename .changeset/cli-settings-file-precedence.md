---
"@maplibre-yaml/cli": patch
---

`preview.port`, `preview.open` and `preview.debug` in `maplibre-yaml.config.*` now take effect. Before, the built-in defaults (port 3000, open the browser, no debug panel) always won over the settings file, so `mlym preview` ignored those settings. The order is now: a flag you type (`--port 4000`, `--no-open`) wins, then the settings file, then the default. `mlym validate` follows the same order for its settings.
