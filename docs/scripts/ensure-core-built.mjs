#!/usr/bin/env node
/**
 * Build the workspace packages the docs site needs, each only if its dist is
 * missing or stale.
 *
 * The docs site needs core's dist (and its emitted JSON schemas), the
 * effects package (the classics launch page's live panes), and the CLI
 * (`mlym emit` produces the launch page's exported panes at build time). A
 * docs-only build (`pnpm --filter docs build`, the Cloudflare Pages deploy
 * from a fresh clone) must build them first. But under the workspace build
 * (`pnpm -r build`) they are already built, and rebuilding one here races
 * every other package that consumes its dist in parallel with docs: tsup's
 * `clean: true` wipes dist/ while e.g. examples/react is bundling against it
 * ("Rollup failed to resolve import ..." from core/dist/register.js). So:
 * rebuild only when the package's entry is absent or older than any file in
 * its src/. Core first — the other two build against it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packages = join(dirname(fileURLToPath(import.meta.url)), "../../packages");

const PACKAGES = [
  { name: "@maplibre-yaml/core", dir: "core", entry: "dist/index.js", also: ["schemas"] },
  { name: "@maplibre-yaml/effects", dir: "effects", entry: "dist/index.js", also: [] },
  { name: "@maplibre-yaml/cli", dir: "cli", entry: "dist/cli.js", also: [] },
];

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

for (const pkg of PACKAGES) {
  const root = join(packages, pkg.dir);
  const built = join(root, pkg.entry);
  const fresh =
    existsSync(built) &&
    pkg.also.every((p) => existsSync(join(root, p))) &&
    statSync(built).mtimeMs >= newestMtime(join(root, "src"));

  if (fresh) {
    console.log(`[docs] ${pkg.name} dist is up to date; not rebuilding.`);
  } else {
    console.log(`[docs] building ${pkg.name} (dist missing or stale)…`);
    execFileSync("pnpm", ["--filter", pkg.name, "build"], { stdio: "inherit" });
  }
}
