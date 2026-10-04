import { defineConfig, devices } from "@playwright/test";

/**
 * Browser verification for the Phase 1 (schema truthfulness) units.
 *
 * @remarks
 * These drive the fixtures in `examples/verification/` against a real MapLibre
 * instance. The unit suites can only prove we passed MapLibre a given object;
 * only a real map proves the feature is visible to a user — which is the whole
 * claim of a release about fields that validated but did nothing.
 *
 * WebGL comes from SwiftShader, so rendering is software and slower than a GPU
 * but deterministic. The fixtures fetch demotiles and terrain tiles over the
 * network, so these are excluded from the default unit run.
 */
/**
 * Same env var e2e/server.mjs listens on. `reuseExistingServer` means a
 * server another worktree left on the default port would otherwise be
 * silently reused — serving THAT tree's files — so parallel worktrees each
 * pick their own port: `VERIFY_PORT=4175 pnpm verify:browser`.
 */
const PORT = Number(process.env.VERIFY_PORT ?? 4174);

export default defineConfig({
  testDir: "./e2e",
  // Software rendering plus real tile fetches; generous but bounded.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "e2e/report", open: "never" }]],
  outputDir: "e2e/results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          // MapLibre needs WebGL; headless Chromium supplies it via SwiftShader.
          args: [
            "--use-gl=swiftshader",
            "--enable-unsafe-swiftshader",
            "--ignore-gpu-blocklist",
          ],
        },
      },
    },
  ],
  webServer: {
    command: "node e2e/server.mjs",
    url: `http://localhost:${PORT}/vendor/maplibre-gl.esm.js`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
