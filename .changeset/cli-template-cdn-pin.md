---
"@maplibre-yaml/cli": patch
---

`mlym init --template basic` and `--template story` now load core from the CDN at the release line the CLI was built with (for example `https://unpkg.com/@maplibre-yaml/core@0.9/register.js`), instead of a pin written into the template that could fall behind a release. A new project therefore always gets the features the current docs describe.
