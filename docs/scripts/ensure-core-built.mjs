#!/usr/bin/env node
/**
 * Build @maplibre-yaml/core only if its dist is missing or stale.
 *
 * The docs site needs core's dist (and its emitted JSON schemas). A docs-only
 * build (`pnpm --filter docs build`, the Cloudflare Pages deploy from a fresh
 * clone) must build core first. But under the workspace build
 * (`pnpm -r build`) core is already built, and rebuilding it here races every
 * other package that consumes core/dist in parallel with docs: core's tsup
 * `clean: true` wipes dist/ while e.g. examples/react is bundling against it
 * ("Rollup failed to resolve import ..." from core/dist/register.js). So:
 * rebuild only when dist/index.js is absent or older than any file in src/.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const core = join(dirname(fileURLToPath(import.meta.url)), "../../packages/core");
const built = join(core, "dist/index.js");

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

const fresh =
  existsSync(built) &&
  existsSync(join(core, "schemas")) &&
  statSync(built).mtimeMs >= newestMtime(join(core, "src"));

if (fresh) {
  console.log("[docs] @maplibre-yaml/core dist is up to date; not rebuilding.");
} else {
  console.log("[docs] building @maplibre-yaml/core (dist missing or stale)…");
  execFileSync("pnpm", ["--filter", "@maplibre-yaml/core", "build"], { stdio: "inherit" });
}
