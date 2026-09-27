/**
 * @file Vitest configuration for Astro package tests
 *
 * @remarks
 * Routed through Astro's `getViteConfig` so `.astro` components compile
 * inside vitest — this is what lets the Container-API behavioral tests
 * (tests/components/container-render.test.ts, ml-qxt) actually render
 * `Map`/`FullPageMap`/`Scrollytelling`/`Chapter` instead of stubbing their
 * prop types. Plain `defineConfig` cannot load `.astro` files.
 */

import { getViteConfig } from "astro/config";

export default getViteConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/**",
        "dist/**",
        "tests/**",
        "**/*.config.ts",
        "**/*.d.ts",
      ],
    },
  },
});
