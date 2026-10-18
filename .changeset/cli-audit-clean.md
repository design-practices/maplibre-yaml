---
"@maplibre-yaml/cli": minor
"maplibre-yaml": patch
---

Installing the CLI reports far fewer known vulnerabilities. Vite moves to 6.4 (dev-server advisories, plus the old esbuild that Vite 5 brought) and chokidar to 4, and file matching moves from fast-glob to tinyglobby. The `braces` package under fast-glob and chokidar 3 has an advisory with no fixed release. Commands and options are unchanged. sharp stays at 0.34.5: its libvips/libheif/librsvg advisories are fixed only in sharp 0.35, which needs Node.js 20.9 or later, and the CLI still supports Node 18. sharp only reads your own sprite images (`emit`/`bake`).
