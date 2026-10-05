import { defineConfig, devices } from "@playwright/test";

/**
 * Drives the example site against an already-running server.
 *
 * @remarks
 * `scripts/astro-matrix.mjs` builds the site on each Astro major, starts
 * `astro preview` (then `astro dev`) and points this config at it through
 * `ASTRO_SITE_URL`. `ASTRO_SITE_MODE=dev` runs only the `@dev` smoke tests:
 * dev mode compiles on demand and had its own break (maplibre-gl not
 * pre-bundled) that a build never shows.
 *
 * Kept out of the repo-root `e2e/` on purpose: the root config serves the
 * verification fixtures from its own static server.
 */
const URL = process.env.ASTRO_SITE_URL ?? "http://localhost:4330";
const DEV = process.env.ASTRO_SITE_MODE === "dev";

export default defineConfig({
  testDir: ".",
  timeout: DEV ? 180_000 : 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  grep: DEV ? /@dev/ : undefined,
  reporter: [["list"]],
  outputDir: process.env.ASTRO_SITE_RESULTS ?? "results",
  use: {
    baseURL: URL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        launchOptions: {
          // MapLibre needs WebGL; headless Chromium supplies it via SwiftShader.
          args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
        },
      },
    },
  ],
});
