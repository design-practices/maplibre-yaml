import { defineConfig } from "tsup";

export default defineConfig([
  // Main build for Node.js/bundlers
  {
    entry: [
      "src/index.ts",
      "src/schemas/index.ts",
      "src/components/index.ts",
      "src/register.ts",
    ],
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    splitting: false,
    treeshake: true,
    external: ["maplibre-gl"],
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
    },
    format: ["esm"],
    dts: false,
    clean: false,
    sourcemap: true,
    splitting: false,
    treeshake: true,
    external: ["maplibre-gl"],
    noExternal: ["yaml", "zod"], // Bundle these for browser
    esbuildOptions(options) {
      options.banner = {
        js: "// @maplibre-yaml/core - Browser build with bundled dependencies",
      };
    },
  },
]);
