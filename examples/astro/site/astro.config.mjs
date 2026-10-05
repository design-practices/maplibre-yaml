// @ts-check
import { createRequire } from "node:module";
import { defineConfig } from "astro/config";

// This site is built on every Astro major @maplibre-yaml/astro supports (CI
// runs it on 4, 5, 6 and 7). The only per-major difference: Astro 4 needs
// the content layer (the glob() loaders in src/content.config.ts) switched
// on; Astro 5+ has it built in and rejects the flag.
const astroMajor = Number(createRequire(import.meta.url)("astro/package.json").version.split(".")[0]);

/** @type {Record<string, unknown>} */
const config = {};
if (astroMajor === 4) config.experimental = { contentLayer: true };

export default defineConfig(config);
