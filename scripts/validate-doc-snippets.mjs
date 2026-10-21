#!/usr/bin/env node
/**
 * validate-doc-snippets.mjs
 *
 * Extracts fenced ```yaml code blocks from documentation files and validates
 * them against the real @maplibre-yaml/core parser:
 *
 *  - a standalone map or scrollytelling document (a top-level `type: map` or
 *    `type: scrollytelling` key), as written;
 *  - a multi-page root document (no `type:`, a top-level `pages:` key);
 *  - a fragment readers paste into a map: a list of layers (every item has an
 *    `id:` and a layer `type:`), or a mapping whose keys are all map-block
 *    keys (`config:`, `layers:`, `sources:`, `controls:`, `legend:` …). The
 *    fragment is wrapped in a minimal map (a placeholder center, zoom and
 *    basemap fill in what it leaves out) and validated as part of it.
 *
 * Other YAML (a layer's `paint:` on its own, frontmatter, CI workflows) is
 * skipped. A fence that is deliberately partial or wrong (an error example,
 * a fragment naming a source defined elsewhere) opts out with `no-validate`
 * in its info string: ```yaml no-validate
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
import { createRequire } from "node:module";
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
// The YAML library core itself parses with, to inspect a fragment's shape.
const YAML = createRequire(join(repoRoot, "packages/core/package.json"))("yaml");

/** Keys a map block takes at its top level (fragments made only of these are wrapped). */
const MAP_BLOCK_KEYS = new Set([
  "config", "layers", "sources", "controls", "legend", "title", "description",
  "markers", "images", "terrain", "sky", "light", "projection", "params",
]);
const LAYER_TYPES = new Set([
  "circle", "line", "fill", "fill-extrusion", "symbol", "heatmap", "hillshade",
  "raster", "background", "color-relief",
]);
const PLACEHOLDER_CONFIG = {
  center: [0, 0],
  zoom: 1,
  mapStyle: "https://tiles.openfreemap.org/styles/liberty",
};

/**
 * A fragment of a map wrapped into a whole map block (YAML text), or null when
 * the fence isn't one: a list of layers, or a mapping of map-block keys only.
 */
function wrapFragment(content) {
  let value;
  try {
    value = YAML.parse(content);
  } catch {
    return null; // several documents (frontmatter), or deliberately broken YAML
  }
  let block;
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((l) => l && typeof l === "object" && "id" in l && LAYER_TYPES.has(l.type))
  ) {
    block = { layers: value };
  } else if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.keys(value).every((k) => MAP_BLOCK_KEYS.has(k))
  ) {
    block = { ...value };
  } else {
    return null;
  }
  return YAML.stringify({
    type: "map",
    id: "snippet",
    ...block,
    config: { ...PLACEHOLDER_CONFIG, ...(block.config ?? {}) },
    layers: block.layers ?? [],
  });
}

/** True for a root document: no top-level `type:`, a top-level `pages:` key. */
function isRootDocument(content) {
  return /^pages:/m.test(content);
}

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
  // The repository README is the GitHub front page; its samples get copied too.
  files.push(join(repoRoot, "README.md"));
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
function extractYamlFences(text, lang = /ya?ml/) {
  const lines = text.split("\n");
  const fences = [];
  let index = 0;
  const openRe = new RegExp(`^(\\s*)(\`{3,})\\s*(?:${lang.source})\\b(.*)$`, "i");
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(openRe);
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

/** Highest zoom demotiles is useful at (it has country shapes only). */
const DEMOTILES_MAX_ZOOM = 6;

/** The problem with a fence that zooms demotiles past its detail, or null. */
function demotilesZoomProblem(content) {
  if (!/demotiles\.maplibre\.org\/style\.json/.test(content)) return null;
  // `zoom: 12` (YAML, JS/TS object literals) and `"zoom": 12` (JSON).
  const zooms = [...content.matchAll(/^\s*-?\s*["']?zoom["']?:[ \t]*([\d.]+)/gm)].map((m) => Number(m[1]));
  const max = Math.max(...zooms, -Infinity);
  if (max <= DEMOTILES_MAX_ZOOM) return null;
  return (
    `uses demotiles at zoom ${max}: demotiles has country shapes only, so past zoom ` +
    `${DEMOTILES_MAX_ZOOM} the map is a flat fill. Use "https://tiles.openfreemap.org/styles/liberty".`
  );
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

  // The demotiles rule applies to code readers copy in any language: a
  // TypeScript or JSON document object at street zoom is the same flat map
  // (ml-aot.55).
  for (const fence of extractYamlFences(text, /ts|typescript|js|javascript|jsx|tsx|json/)) {
    const demoZoom = demotilesZoomProblem(fence.content);
    if (demoZoom) {
      failures.push({ file: rel, index: fence.index, line: fence.line, errors: [demoZoom] });
    }
  }

  // The generated reference (TypeDoc, YAML reference) is rebuilt from core's
  // source; its fragments are fixed there, not here.
  const generated = /docs\/src\/content\/docs\/reference\/(api|yaml)\//.test(rel);
  for (const fence of extractYamlFences(text)) {
    // demotiles has country polygons only: past zoom ~6 a map or story on it
    // is a flat green field with no coastline, roads or labels, which a
    // reader takes for a broken map (ml-aot.34). Checked on every fence,
    // fragments included, since readers copy those too.
    const demoZoom = demotilesZoomProblem(fence.content);
    if (demoZoom) {
      failures.push({ file: rel, index: fence.index, line: fence.line, errors: [demoZoom] });
    }

    if (/\bno-validate\b/.test(fence.meta)) {
      skipped++;
      continue;
    }
    const type = topLevelType(fence.content);
    let result;
    let kind = "";
    if (type === "map") {
      result = YAMLParser.safeParseMapBlock(fence.content);
    } else if (type === "scrollytelling") {
      result = YAMLParser.safeParseScrollytellingBlock(fence.content);
    } else if (type === null && generated) {
      // Generated from core's JSDoc: only whole documents are checked there.
      skipped++;
      continue;
    } else if (type === null && isRootDocument(fence.content)) {
      result = YAMLParser.safeParse(fence.content);
      kind = " (root document)";
    } else if (type === null) {
      const wrapped = wrapFragment(fence.content);
      if (wrapped === null) {
        skipped++;
        continue;
      }
      result = YAMLParser.safeParseMapBlock(wrapped);
      kind = " (fragment, wrapped in a map)";
    } else {
      skipped++;
      continue;
    }

    checked++;
    if (!result.success) {
      failures.push({
        file: rel,
        index: fence.index,
        line: fence.line,
        kind,
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
    console.error(`- ${f.file} (snippet #${f.index}, fence at line ${f.line})${f.kind ?? ""}`);
    for (const e of f.errors) {
      console.error(`    ${e}`);
    }
  }
  process.exit(1);
}

console.log("All map/scrollytelling YAML snippets are valid.");
