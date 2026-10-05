/**
 * @file maplibre-gl 6 worker URL for the Astro components
 * @module @maplibre-yaml/astro/client/maplibre-worker
 *
 * @description
 * maplibre-gl 6 is ESM-only and loads its worker (`maplibre-gl-worker.mjs`)
 * from next to its own module URL. Astro bundles the components' scripts with
 * Vite, so that URL is a bundle chunk's and the worker is not beside it —
 * every map would fail with "Worker failed to load". MapLibre's fix is for
 * the bundler user to call `setWorkerUrl()`; the components do it for them.
 *
 * The worker is found with `import.meta.glob`, not a static `?url` import:
 * on maplibre-gl 4/5 the file does not exist and a static import would fail
 * the build, while a glob that matches nothing is an empty object. Two
 * patterns cover the two places maplibre-gl sits relative to this file — a
 * sibling package (npm, and pnpm's peer links:
 * `node_modules/@maplibre-yaml/astro/src/client` → `node_modules/maplibre-gl`)
 * and this package's own `node_modules` (a workspace link). Anything else
 * (Yarn PnP, unusual hoisting) finds nothing, and the map's error then says
 * how to call `setWorkerUrl()` by hand (core's `withWorkerUrlHint`).
 *
 * `setWorkerModuleUrl` applies only on maplibre-gl 6+ and never overrides a
 * worker URL the page already set.
 */

import { setWorkerModuleUrl } from "@maplibre-yaml/core/maplibre";

const found: Record<string, string> = {
  ...import.meta.glob<string>("../../../../maplibre-gl/dist/maplibre-gl-worker.mjs", {
    query: "?worker&url",
    import: "default",
    eager: true,
  }),
  ...import.meta.glob<string>("../../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", {
    query: "?worker&url",
    import: "default",
    eager: true,
  }),
};

setWorkerModuleUrl(Object.values(found)[0]);
