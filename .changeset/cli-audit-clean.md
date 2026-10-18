---
"@maplibre-yaml/cli": minor
"maplibre-yaml": patch
---

Installing the CLI no longer reports known vulnerabilities: `npm install @maplibre-yaml/cli` used to print "8 vulnerabilities (1 moderate, 7 high) — no fix available" and now reports 0. sharp moves to 0.35.5 (libvips, libheif and librsvg advisories), Vite to 6.4 (dev-server advisories, and the old esbuild Vite 5 brought), chokidar to 4, and file matching from fast-glob to tinyglobby (the `braces` package under fast-glob and chokidar 3 has an advisory with no fixed release). Commands and options are unchanged. The CLI now declares Node.js 20.9 or later, the minimum sharp 0.35 supports (Node 18 reached end of life in 2025); the current LTS, 22 or 24, is recommended.
