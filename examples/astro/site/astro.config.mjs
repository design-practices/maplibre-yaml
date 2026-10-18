// @ts-check
import { createRequire } from "node:module";
import { defineConfig } from "astro/config";
import maplibreYaml from "@maplibre-yaml/astro/integration";

// This site is built on every Astro major @maplibre-yaml/astro supports (CI
// runs it on 4, 5, 6 and 7). Per-major differences:
// - Astro 4 needs the content layer (the glob() loaders in
//   src/content.config.ts) switched on; Astro 5+ has it built in and rejects
//   the flag.
// - Astro 6's dev server does not scan .astro <script>s for browser
//   dependencies (Astro 7 does), so the modules behind <ClientRouter /> are
//   found only when the first page using it loads. Vite then re-optimizes,
//   answers modules the page already requested with "504 (Outdated Optimize
//   Dep)" and reloads it mid-navigation. Listing them here pre-bundles them
//   when the server starts. (The integration does the same for maplibre-gl and
//   @maplibre-yaml/core on every major.)
const astroMajor = Number(createRequire(import.meta.url)("astro/package.json").version.split(".")[0]);

/** @type {import("astro").AstroUserConfig} */
const config = {
  // Optional: astro dev reloads when a map file changes, and pre-bundles the
  // map components' browser dependencies.
  integrations: [maplibreYaml()],
};
if (astroMajor === 4) config.experimental = /** @type {any} */ ({ contentLayer: true });
if (astroMajor === 6) {
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
