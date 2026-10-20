#!/usr/bin/env node
/**
 * sync-cdn-pins.mjs
 *
 * Every plain-HTML entry point loads the library from a CDN with a minor pin,
 * e.g. `https://unpkg.com/@maplibre-yaml/core@0.9/register.js`. A pin left
 * behind after a release sends readers of the docs to the previous minor,
 * where the new features do not exist (ml-aot.92). This script keeps every
 * `@maplibre-yaml/<core|astro|cli>@<major>.<minor>` pin equal to that
 * package's current `<major>.<minor>`.
 *
 * It runs after `changeset version` (root script `version-packages`, which
 * the release workflow's changesets action calls), so the release PR carries
 * the new pins with the new version. A `--check` run guards it (CLI test).
 *
 * Exact versions (`@0.9.0`) are left alone: those name one release on
 * purpose. The CLI's own templates take the version from core's package.json
 * at build time and carry no pin.
 *
 * Usage:
 *   node scripts/sync-cdn-pins.mjs            rewrite stale pins
 *   node scripts/sync-cdn-pins.mjs --check    exit 1 listing stale pins
 *   node scripts/sync-cdn-pins.mjs --dry-run  print the change, write nothing
 *   ... --version core=0.9.0                  pretend a package is at a version
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const PACKAGES = ["core", "astro", "cli"];

/** Where pins live. Directories are walked; files are read as they are. */
const ROOTS = [
  "README.md",
  "packages/core/README.md",
  "packages/astro/README.md",
  "packages/cli/README.md",
  "docs/src",
  "examples",
  "e2e",
];
const EXTENSIONS = [".md", ".mdx", ".html", ".astro", ".ts", ".tsx", ".js", ".mjs", ".yaml", ".yml"];
/**
 * Paths never rewritten: generated API reference, build output, and pages
 * that pin an old or exact version on purpose (the editor-setup page shows
 * how to pin a schema to the version a project uses; the verification pages
 * pin the release they verify).
 */
const SKIP = [
  "node_modules",
  "dist",
  ".astro",
  "docs/src/content/docs/reference/api",
  "docs/src/content/docs/guides/editor-setup.mdx",
  "examples/verification",
];

const PIN = /@maplibre-yaml\/(core|astro|cli)@(\d+)\.(\d+)(?![\d.])/g;

function skipped(path) {
  const rel = relative(repoRoot, path).split(sep).join("/");
  return SKIP.some((s) => rel === s || rel.startsWith(`${s}/`) || rel.split("/").includes(s));
}

function walk(path, out = []) {
  if (!existsSync(path) || skipped(path)) return out;
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path)) walk(join(path, entry), out);
  } else if (EXTENSIONS.some((ext) => path.endsWith(ext))) {
    out.push(path);
  }
  return out;
}

/** `{ core: "0.9", ... }` from the packages' package.json (or overrides). */
export function currentMinors(overrides = {}) {
  const minors = {};
  for (const name of PACKAGES) {
    const version =
      overrides[name] ??
      JSON.parse(readFileSync(join(repoRoot, "packages", name, "package.json"), "utf8")).version;
    const [major, minor] = String(version).split("-")[0].split(".");
    minors[name] = `${major}.${minor}`;
  }
  return minors;
}

/**
 * Every pin in the pinned files: `{ file, line, text, package, pinned, want }`.
 */
export function findPins(minors = currentMinors()) {
  const pins = [];
  for (const file of ROOTS.flatMap((r) => walk(join(repoRoot, r)))) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, i) => {
      for (const m of text.matchAll(PIN)) {
        pins.push({
          file: relative(repoRoot, file),
          line: i + 1,
          text,
          package: m[1],
          pinned: `${m[2]}.${m[3]}`,
          want: minors[m[1]],
        });
      }
    });
  }
  return pins;
}

function rewrite(text, minors) {
  return text.replace(PIN, (_, pkg) => `@maplibre-yaml/${pkg}@${minors[pkg]}`);
}

function main(argv) {
  const check = argv.includes("--check");
  const dryRun = argv.includes("--dry-run");
  const overrides = {};
  argv.forEach((arg, i) => {
    if (arg !== "--version") return;
    const [name, version] = String(argv[i + 1] ?? "").split("=");
    if (!PACKAGES.includes(name) || !version) {
      console.error("usage: --version <core|astro|cli>=<x.y.z>");
      process.exit(2);
    }
    overrides[name] = version;
  });
  const minors = currentMinors(overrides);
  const pins = findPins(minors);
  const stale = pins.filter((p) => p.pinned !== p.want);

  if (check) {
    if (stale.length === 0) {
      console.log(`CDN pins: ${pins.length} pins match (${JSON.stringify(minors)}).`);
      return 0;
    }
    console.error(`CDN pins: ${stale.length} stale pin(s); run node scripts/sync-cdn-pins.mjs`);
    for (const p of stale) {
      console.error(`  ${p.file}:${p.line}  @maplibre-yaml/${p.package}@${p.pinned} (want ${p.want})`);
    }
    return 1;
  }

  const files = [...new Set(stale.map((p) => p.file))];
  for (const rel of files) {
    const path = join(repoRoot, rel);
    const before = readFileSync(path, "utf8");
    const after = rewrite(before, minors);
    if (dryRun) {
      const a = before.split("\n");
      const b = after.split("\n");
      console.log(`--- a/${rel}\n+++ b/${rel}`);
      a.forEach((line, i) => {
        if (line !== b[i]) console.log(`@@ line ${i + 1} @@\n-${line}\n+${b[i]}`);
      });
    } else {
      writeFileSync(path, after);
    }
  }
  console.log(
    `CDN pins: ${stale.length} of ${pins.length} pin(s) in ${files.length} file(s) ` +
      `${dryRun ? "would change" : "updated"} (${JSON.stringify(minors)}).`
  );
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
