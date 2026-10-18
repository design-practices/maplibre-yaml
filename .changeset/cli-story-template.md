---
"@maplibre-yaml/cli": patch
---

`init --template story` now scaffolds a story map that works as soon as you serve the folder: its page loads `<ml-scrollytelling>` from `@maplibre-yaml/core@0.8` on the CDN (the release that adds it), and the "not part of core 0.7 yet" notes are gone; `init` prints the same serve-and-open steps as for `basic`. Both the `basic` and `story` pages now pin core 0.8 and carry a commented `base="/my-repo/"` hint for publishing on a GitHub Pages project site, and the YAML tip no longer says paths must start with `./` (plain relative paths and `/`-paths both work).
