import { defineConfig } from "tsup";

export default defineConfig([
  // Main build for Node.js/bundlers
  {
    entry: [
      "src/index.ts",
      "src/schemas/index.ts",
      "src/components/index.ts",
      // The DOM-free scrollytelling engine + renderers (server-safe: Astro
      // frontmatter imports it; the element lives in components/register).
      "src/scrollytelling/index.ts",
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
    // `@bokuweb/zstd-wasm` (flatgeobuf's codec for the rare seekable-zstd
    // variant, reached by a dynamic import) stays a real dependency: a
    // bundler resolving this build (Vite's dependency optimizer) must find it.
    external: ["maplibre-gl", "react", "@bokuweb/zstd-wasm"],
    // The cloud-native decoders are bundled here too, as in the browser
    // build, and are devDependencies: flatgeobuf declares OpenLayers (`ol`,
    // ~30 MB with geotiff) as an optional dependency, which npm installs,
    // so depending on it put that tree under every core, astro and cli
    // install. Bundled, only the code core uses ships (~20 KB gzip).
    noExternal: ["pmtiles", "fflate", "flatgeobuf", "flatbuffers", "slice-source", "@repeaterjs/repeater"],
    esbuildOptions(options) {
      options.banner = {
        js: "// @maplibre-yaml/core - Declarative web maps with YAML",
      };
      // fflate's `node` build (resolved on this platform) opens with
      // `createRequire` from "module" for worker_threads, which breaks this
      // build in every browser bundler. Its plain-ESM `browser` build works
      // in Node too (pmtiles uses only the synchronous decoder).
      options.alias = { ...(options.alias ?? {}), fflate: "fflate/browser" };
    },
  },
  // Browser build with bundled dependencies
  {
    entry: {
      "register.browser": "src/register.ts",
      // The full public API, browser-bundled. `index.js` bare-imports yaml/zod
      // which no browser resolves; this is what a page importing the emitter,
      // parser, or model directly (rather than the `<ml-map>` component) loads.
      // The export-proof browser demo is the motivating consumer: it compiles a
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
    // `@bokuweb/zstd-wasm` is flatgeobuf's codec for seekable-zstd files,
    // reached only through a dynamic import that maplibre-yaml never
    // triggers (compressed files are refused with a plain notice). A CDN
    // page cannot resolve the bare specifier, so here it resolves to a stub
    // that fails plainly (ml-aot.109); bundler builds keep the dependency.
    external: ["maplibre-gl"],
    // Bundle these for browser. The cloud-native decoders (ml-cnv, 0.9) are
    // bundled into the single file — no chunks yet; formats/decoders.ts is
    // the seam lazy loading (ml-7qa.5) will split at.
    noExternal: [
      "yaml",
      "zod",
      "pmtiles",
      "fflate",
      "flatgeobuf",
      "flatbuffers",
      "slice-source",
      "@repeaterjs/repeater",
      // Resolved to the stub below (the alias), not the package.
      "@bokuweb/zstd-wasm",
    ],
    esbuildOptions(options) {
      options.banner = {
        js: "// @maplibre-yaml/core - Browser build with bundled dependencies",
      };
      options.alias = {
        ...(options.alias ?? {}),
        "@bokuweb/zstd-wasm": "./src/formats/zstd-unavailable.ts",
      };
    },
  },
]);
