import { defineConfig } from "tsup";

/**
 * Three outputs, mirroring core's split:
 *
 * - `index.js` / `register.js` for bundlers: zod external (shared with
 *   core), maplibre-gl external (the peer), everything else bundled.
 * - `extrusions-worker.js`: the tile-mesh worker, fully self-contained (the
 *   tile decoder, earcut and MapLibre's style-spec expression evaluator all
 *   run in it). Loaded with `new Worker(new URL("./extrusions-worker.js",
 *   import.meta.url), { type: "module" })`, which bundlers like Vite
 *   follow and plain ESM resolves beside whichever file asked for it.
 * - `index.browser.js` / `register.browser.js` for a plain
 *   `<script type="module">` with an import map: zod inlined, so the only
 *   bare specifier left is `maplibre-gl` — and that is type-only here, so in
 *   practice none.
 */
const banner = { js: "// @maplibre-yaml/effects (EXPERIMENTAL) - shader effects for maplibre-yaml" };

export default defineConfig([
  {
    entry: ["src/index.ts", "src/register.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    splitting: true,
    treeshake: true,
    external: ["maplibre-gl", "zod"],
    esbuildOptions(options) {
      options.banner = banner;
    },
  },
  {
    entry: { "extrusions-worker": "src/backends/extrusions/worker.ts" },
    format: ["esm"],
    platform: "browser",
    dts: false,
    clean: false,
    sourcemap: true,
    splitting: false,
    treeshake: true,
    minify: true,
    noExternal: [/.*/],
    esbuildOptions(options) {
      options.banner = banner;
    },
  },
  {
    entry: {
      "index.browser": "src/index.ts",
      "register.browser": "src/register.ts",
    },
    format: ["esm"],
    platform: "browser",
    dts: false,
    clean: false,
    sourcemap: true,
    splitting: true,
    treeshake: true,
    minify: true,
    external: ["maplibre-gl"],
    noExternal: ["zod"],
    esbuildOptions(options) {
      options.banner = banner;
      options.chunkNames = "browser-[name]-[hash]";
    },
  },
]);
