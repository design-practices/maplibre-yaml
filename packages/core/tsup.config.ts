import { defineConfig } from "tsup";

export default defineConfig({
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
});
