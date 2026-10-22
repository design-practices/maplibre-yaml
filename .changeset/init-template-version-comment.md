---
"@maplibre-yaml/cli": patch
---

The `index.html` that `mlym init` writes for the `basic` and `story` templates no longer says `"@0.8" means the newest 0.8.x release` above a script tag that loads 0.9. The comment now names the same release line as the script URL, and both come from the `@maplibre-yaml/core` version the CLI was built with, so they stay in step with every future release.
