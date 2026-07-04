#!/usr/bin/env node
/**
 * validate-doc-snippets.mjs
 *
 * Extracts fenced ```yaml code blocks from documentation files and validates
 * any block that is a standalone map or scrollytelling document (i.e. has a
 * top-level `type: map` or `type: scrollytelling` key) against the real
 * @maplibre-yaml/core parser. YAML fragments without a top-level `type:` key
 * are skipped, as are fences tagged with `no-validate` in their info string.
 *
 * Requires @maplibre-yaml/core to be built first:
 *   pnpm --filter @maplibre-yaml/core build
 *
 * Usage:
 *   node scripts/validate-doc-snippets.mjs [files...]
 *
 * With no arguments, walks the default documentation set (docs/ content,
 * docs/patterns/, and packages/(asterisk)/README.md).
 *
 * Exits non-zero listing file + snippet index + errors on any failure.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const coreDist = join(repoRoot, "packages/core/dist/index.js");
if (!existsSync(coreDist)) {
  console.error(
    "error: packages/core/dist/index.js not found. Run `pnpm --filter @maplibre-yaml/core build` first."
  );
  process.exit(2);
}

const { YAMLParser } = await import(coreDist);

/** Recursively collect files under `dir` matching one of `exts`. */
function walk(dir, exts, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, exts, out);
    } else if (exts.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function defaultFileSet() {
  const files = [];
  const docsContent = join(repoRoot, "docs/src/content/docs");
  if (existsSync(docsContent)) walk(docsContent, [".md", ".mdx"], files);
  const patterns = join(repoRoot, "docs/patterns");
  if (existsSync(patterns)) walk(patterns, [".md", ".mdx"], files);
  const packagesDir = join(repoRoot, "packages");
  if (existsSync(packagesDir)) {
    for (const pkg of readdirSync(packagesDir)) {
      const readme = join(packagesDir, pkg, "README.md");
      if (existsSync(readme)) files.push(readme);
    }
  }
  return files;
}

/**
 * Extract fenced yaml code blocks from markdown/MDX text.
 * Handles fences indented inside components (e.g. Starlight <Steps>).
 * Returns [{ index, content, meta, line }]
 */
function extractYamlFences(text) {
  const lines = text.split("\n");
  const fences = [];
  let index = 0;
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^(\s*)(`{3,})\s*ya?ml\b(.*)$/i);
    if (!open) continue;
    const [, indent, ticks, meta] = open;
    const closeRe = new RegExp(`^\\s*\`{${ticks.length},}\\s*$`);
    const content = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (closeRe.test(lines[j])) break;
      // Dedent by the fence's indentation.
      content.push(
        lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j]
      );
    }
    fences.push({
      index: index++,
      content: content.join("\n"),
      meta: meta.trim(),
      line: i + 1,
    });
    i = j;
  }
  return fences;
}

/** Detect a top-level `type:` key and return its value, or null. */
function topLevelType(content) {
  const m = content.match(
    /^type:[ \t]*["']?([A-Za-z-]+)["']?[ \t]*(?:#.*)?$/m
  );
  return m ? m[1] : null;
}

const args = process.argv.slice(2);
const files = args.length > 0 ? args.map((f) => join(process.cwd(), f)) : defaultFileSet();

let checked = 0;
let skipped = 0;
const failures = [];

for (const file of files) {
  const rel = relative(repoRoot, file);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    failures.push({ file: rel, index: -1, line: 0, errors: [`cannot read file: ${err.message}`] });
    continue;
  }

  for (const fence of extractYamlFences(text)) {
    if (/\bno-validate\b/.test(fence.meta)) {
      skipped++;
      continue;
    }
    const type = topLevelType(fence.content);
    if (type !== "map" && type !== "scrollytelling") {
      skipped++;
      continue;
    }

    checked++;
    const result =
      type === "map"
        ? YAMLParser.safeParseMapBlock(fence.content)
        : YAMLParser.safeParseScrollytellingBlock(fence.content);

    if (!result.success) {
      failures.push({
        file: rel,
        index: fence.index,
        line: fence.line,
        errors: result.errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)),
      });
    }
  }
}

console.log(
  `validate-doc-snippets: ${checked} snippet(s) validated, ${skipped} skipped, across ${files.length} file(s).`
);

if (failures.length > 0) {
  console.error(`\n${failures.length} invalid snippet(s):\n`);
  for (const f of failures) {
    console.error(`- ${f.file} (snippet #${f.index}, fence at line ${f.line})`);
    for (const e of f.errors) {
      console.error(`    ${e}`);
    }
  }
  process.exit(1);
}

console.log("All map/scrollytelling YAML snippets are valid.");
