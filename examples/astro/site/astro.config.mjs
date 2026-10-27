// @ts-check
import { createRequire } from "node:module";
import { defineConfig } from "astro/config";
import maplibreYaml from "@maplibre-yaml/astro/integration";

// This site is built on every Astro major @maplibre-yaml/astro supports (CI
// runs it on 4, 5, 6 and 7). Per-major differences:
// - Astro 4 needs the content layer (the glob() loaders in
//   src/content.config.ts) switched on; Astro 5+ has it built in and rejects
//   the flag.
// - On Astro 6 and 7 the dev server's dependency scan never reaches the
//   modules behind <ClientRouter />: its script imports
//   `astro:transitions/client`, which Astro excludes from the scan
//   (`astro:*`), so `astro/virtual-modules/transitions-*.js` are found only
//   when the first page using the router loads. Vite then re-optimizes, and
//   when the re-bundle rewrites an already-served dependency (with core 0.10
//   it reorders the chunk imports of @maplibre-yaml/core/register) it answers
//   the page's requests with "504 (Outdated Optimize Dep)" and reloads it
//   mid-navigation. Listing them here pre-bundles them when the server
//   starts, so nothing is discovered late. (The integration does the same for
//   maplibre-gl and @maplibre-yaml/core on every major.)
const astroMajor = Number(createRequire(import.meta.url)("astro/package.json").version.split(".")[0]);

/** @type {import("astro").AstroUserConfig} */
const config = {
  // Optional: astro dev reloads when a map file changes, and pre-bundles the
  // map components' browser dependencies.
  integrations: [maplibreYaml()],
};
if (astroMajor === 4) config.experimental = /** @type {any} */ ({ contentLayer: true });
if (astroMajor >= 6) {
  config.vite = {
    optimizeDeps: {
      include: [
        "astro/virtual-modules/transitions-router.js",
        "astro/virtual-modules/transitions-types.js",
        "astro/virtual-modules/transitions-events.js",
        "astro/virtual-modules/transitions-swap-functions.js",
      ],
    },
  };
}

export default defineConfig(config);
