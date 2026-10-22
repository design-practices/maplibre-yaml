---
"@maplibre-yaml/cli": patch
"@maplibre-yaml/astro": patch
---

The `astro` project template from `mlym init -t astro` now asks for Node.js 22.23.4 or later in its `package.json` `engines`, which is what Astro 7.4.2 requires. Before, it asked for 22.22, so a new project could install on a Node version that Astro then refuses to run on. The `@maplibre-yaml/astro` README now gives the same minimum for Astro 7.
