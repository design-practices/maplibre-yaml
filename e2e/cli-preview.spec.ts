/**
 * `mlym preview` (ml-pru) — browser verification, which is also the demo.
 *
 * @remarks
 * Starts the built CLI's preview server on the fixture in
 * `examples/verification/cli-preview/` (copied to a temp dir, since the test
 * edits it) and drives the page a student sees:
 *
 *  - the map renders, on the maplibre-gl 6 the CLI's core resolves, served
 *    from the local install: no CDN request at all (the page used to pin
 *    maplibre-gl@4 from unpkg + esm.sh), and the v6 worker loads from next to
 *    its module;
 *  - editing the YAML reloads the page with the change (live reload never
 *    fired before: `import.meta.hot` does not exist in the raw-served page);
 *  - an invalid edit shows the validation error overlay.
 *
 * Requires `pnpm build` (the CLI's dist/ and core's dist/), as CI runs it
 * before this suite.
 */
import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Playwright runs from the repo root (playwright.config.ts lives there).
const ROOT = process.cwd();
const CLI = join(ROOT, "packages/cli/dist/cli.js");
const FIXTURE = join(ROOT, "examples/verification/cli-preview");

/** The maplibre-gl version the CLI's core resolves (its peer). */
function installedMaplibreVersion(): string {
  const coreDir = realpathSync(join(ROOT, "packages/cli/node_modules/@maplibre-yaml/core"));
  const req = createRequire(join(coreDir, "package.json"));
  return JSON.parse(readFileSync(req.resolve("maplibre-gl/package.json"), "utf-8")).version;
}

// The page serves maplibre-gl from the local install only on v6 (the first
// line with an ES module build); on the CI matrix's 4.x/5.x legs preview
// falls back to unpkg, which this hermetic suite forbids. The fallback is
// covered by the CLI's preview-server integration test.
const MAPLIBRE_MAJOR = Number(installedMaplibreVersion().split(".")[0]);
test.skip(
  MAPLIBRE_MAJOR < 6,
  `preview serves maplibre-gl locally only from v6 (installed: ${installedMaplibreVersion()}); older lines use the CDN fallback`
);

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

let dir: string;
let yamlPath: string;
let original: string;
let child: ChildProcess;
let url: string;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mlym-preview-e2e-"));
  cpSync(FIXTURE, dir, { recursive: true });
  yamlPath = join(dir, "map.yaml");
  original = readFileSync(yamlPath, "utf-8");
  const port = await freePort();
  url = `http://localhost:${port}/`;
  child = spawn(process.execPath, [CLI, "preview", yamlPath, "--port", String(port), "--no-open"], {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`preview did not start:\n${output}`)), 30_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("Preview server running")) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`preview exited (${code}):\n${output}`));
    });
  });
});

test.afterAll(() => {
  child?.kill();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function guard(page: Page): Promise<{ errors: string[]; requests: string[] }> {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("request", (r) => requests.push(r.url()));
  await page.route("**/*", (route) => {
    const u = route.request().url();
    if (/^(https?|wss?):\/\/(localhost|127\.0\.0\.1)[:/]/.test(u) || /^(data|blob):/.test(u)) {
      return route.continue();
    }
    errors.push(`external request (preview must work offline): ${u}`);
    return route.abort();
  });
  return { errors, requests };
}

/** Wait until the preview's map has drawn the fixture's circle layer. */
async function waitForCities(page: Page) {
  await page.waitForFunction(
    () => {
      const map = (document.querySelector("ml-map") as any)?.getMap?.();
      if (!map || !map.isStyleLoaded?.() || !map.getLayer?.("cities")) return false;
      const p = map.project([-74.006, 40.7128]);
      return map.queryRenderedFeatures(p, { layers: ["cities"] }).length > 0;
    },
    undefined,
    { timeout: 60_000 }
  );
}

test("preview renders the map on the locally installed maplibre-gl 6", async ({ page }, testInfo) => {
  const { errors, requests } = await guard(page);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForCities(page);

  // The bare specifier resolves (through the page's import map) to the
  // installed maplibre-gl, not a CDN copy of another major.
  const version = await page.evaluate(async () => (await import("maplibre-gl" as string)).getVersion());
  expect(version).toBe(installedMaplibreVersion());
  expect(Number(version.split(".")[0])).toBeGreaterThanOrEqual(6);

  const local = (name: string) => requests.some((r) => r.startsWith(url) && r.endsWith("/" + name));
  expect(local("maplibre-gl.mjs"), "module not served locally").toBe(true);
  expect(local("maplibre-gl-worker.mjs"), "v6 worker not loaded from next to its module").toBe(true);
  expect(local("maplibre-gl.css"), "CSS not served locally").toBe(true);

  await testInfo.attach("preview", { body: await page.screenshot(), contentType: "image/png" });
  expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
});

test("preview renders a scrollytelling story (ml-aot.41)", async ({ page }, testInfo) => {
  const port = await freePort();
  const storyUrl = `http://localhost:${port}/`;
  const story = spawn(
    process.execPath,
    [CLI, "preview", join(dir, "story.yaml"), "--port", String(port), "--no-open"],
    { cwd: dir, stdio: ["ignore", "pipe", "pipe"] }
  );
  try {
    let output = "";
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`preview did not start:\n${output}`)), 30_000);
      const onData = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes("Preview server running")) {
          clearTimeout(timer);
          resolve();
        }
      };
      story.stdout!.on("data", onData);
      story.stderr!.on("data", onData);
    });
    const { errors } = await guard(page);
    await page.goto(storyUrl, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".error-overlay")).toHaveCount(0);
    await expect(page.locator("ml-scrollytelling .scrolly-chapter")).toHaveCount(2);
    await page.evaluate(() => (document.querySelector("ml-scrollytelling") as any).mapReady());
    await expect
      .poll(() => page.evaluate(() => (document.querySelector("ml-scrollytelling") as HTMLElement).dataset.activeChapter))
      .toBe("new-york");
    // Scroll on to the second chapter: the story drives the camera.
    await page.evaluate(() => {
      const s = document.querySelector('.scrolly-chapter[data-chapter-id="chicago"]')!;
      scrollBy(0, s.getBoundingClientRect().top);
    });
    await expect
      .poll(() => page.evaluate(() => (document.querySelector("ml-scrollytelling") as HTMLElement).dataset.activeChapter))
      .toBe("chicago");
    await testInfo.attach("story", { body: await page.screenshot(), contentType: "image/png" });
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  } finally {
    story.kill();
  }
});

test("editing the YAML live-reloads the preview; an invalid edit shows the error", async ({ page }, testInfo) => {
  const { errors } = await guard(page);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForCities(page);
  // Subscribed to the dev server before editing.
  await page.waitForFunction(() => performance.getEntriesByType("resource").some((e) => e.name.endsWith("/@vite/client")));
  await page.waitForTimeout(500);

  try {
    await Promise.all([
      page.waitForEvent("load", { timeout: 15_000 }),
      Promise.resolve().then(() => writeFileSync(yamlPath, original.replace('"#e63946"', '"#1d4ed8"'))),
    ]);
    await waitForCities(page);
    const colour = await page.evaluate(() =>
      (document.querySelector("ml-map") as any).getMap().getPaintProperty("cities", "circle-color")
    );
    expect(colour).toBe("#1d4ed8");
    await testInfo.attach("after-edit", { body: await page.screenshot(), contentType: "image/png" });

    await Promise.all([
      page.waitForEvent("load", { timeout: 15_000 }),
      Promise.resolve().then(() => writeFileSync(yamlPath, original.replace("type: circle", "type: circel"))),
    ]);
    const overlay = page.locator(".error-overlay .error-message");
    await expect(overlay).toContainText("circel");
    await testInfo.attach("validation-error", { body: await page.screenshot(), contentType: "image/png" });
  } finally {
    writeFileSync(yamlPath, original);
  }
  expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
});
