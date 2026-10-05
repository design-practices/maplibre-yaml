import { defineConfig } from "tsup";

export default defineConfig([
  // Main build for Node.js/bundlers
  {
    entry: [
      "src/index.ts",
      "src/schemas/index.ts",
      "src/components/index.ts",
      "src/register.ts",
      "src/maplibre.ts",
      // Types-only entry (React JSX typings). Its JS output is an empty
      // module; it exists so `import "@maplibre-yaml/core/react"` resolves
      // in bundlers as well as in tsc.
      "src/react.ts",
    ],
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    splitting: false,
    treeshake: true,
    // `react` is only ever imported for types (src/react.ts); keep the
    // declaration bundler from inlining @types/react into dist/react.d.ts.
    external: ["maplibre-gl", "react"],
    esbuildOptions(options) {
      options.banner = {
        js: "// @maplibre-yaml/core - Declarative web maps with YAML",
      };
    },
  },
  // Browser build with bundled dependencies
  {
    entry: {
      "register.browser": "src/register.ts",
      // The full public API, browser-bundled. `index.js` bare-imports yaml/zod
      // which no browser resolves; this is what a page importing the emitter,
      // parser, or model directly (rather than the `<ml-map>` component) loads.
      // The eject-proof browser demo is the motivating consumer: it compiles a
      // document and renders the output in vanilla maplibre-gl.
      "index.browser": "src/index.ts",
    },
    format: ["esm"],
    // Resolve bundled deps via their browser conditions: without this,
    // esbuild pulls in yaml's Node CJS entry, which calls require("process")
    // and throws "Dynamic require of 'process' is not supported" the moment
    // a real browser loads the bundle.
    platform: "browser",
    dts: false,
    clean: false,
    sourcemap: true,
    splitting: false,
    treeshake: true,
    minify: true, // CDN-served raw from unpkg — ship it minified
    external: ["maplibre-gl"],
    noExternal: ["yaml", "zod"], // Bundle these for browser
    esbuildOptions(options) {
      options.banner = {
        js: "// @maplibre-yaml/core - Browser build with bundled dependencies",
      };
    },
  },
]);
