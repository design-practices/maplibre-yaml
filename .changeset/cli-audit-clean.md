---
"@maplibre-yaml/cli": minor
"maplibre-yaml": minor
---

Installing the CLI no longer reports known vulnerabilities. `npm install @maplibre-yaml/cli` used to print "9 vulnerabilities (8 high), no fix available"; it now reports 0. sharp moves to 0.35.5, which fixes the libvips, libheif and librsvg advisories. Vite moves to 6.4, fixing dev-server advisories and the old esbuild Vite 5 brought. chokidar moves to 4 and file matching from fast-glob to tinyglobby, because the `braces` package they used has an advisory with no fixed release. Commands and options are unchanged.

**The CLI now needs Node.js 20.9 or later** (22 or 24 LTS recommended). sharp 0.35's security fixes don't run on older Node, and Node 18 reached end of life in 2025. On an older Node the CLI stops at once with "maplibre-yaml needs Node.js 20.9 or newer, but this is Node.js 18.x" and how to update, instead of failing later. The `maplibre-yaml` alias raises its Node minimum with it, so it moves to a minor version and `^0.1` installs on Node 18 keep the old one. This applies to the command line only: `@maplibre-yaml/core` and `@maplibre-yaml/astro` still support Node 18.
