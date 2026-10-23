/**
 * Bundle discipline for the playground (design D10, ml-vjs.17): the editor
 * costs nothing on any page but /playground/.
 *
 *  - Its dependencies (CodeMirror, lz-string, fflate) are the docs site's
 *    alone: no published package depends on them.
 *  - In the built site, no page other than /playground/ loads a chunk that
 *    contains CodeMirror, and /playground/ loads it only through a dynamic
 *    import, so the map can start before the editor arrives.
 *  - The editor chunk stays within its size budget.
 *
 * The built-site checks read docs/dist, so they run after a build
 * (`pnpm build`, as presubmit and CI do).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(DOCS, "..");
const DIST = join(DOCS, "dist");
const ASTRO = join(DIST, "_astro");

/** Packages that are the playground's to depend on, and no one else's. */
const EDITOR_DEPS = [/^@codemirror\//, /^@lezer\//, /^lz-string$/, /^fflate$/];
/** Gzipped size budget for the editor chunk (design: 128 KB measured, 140 KB ceiling). */
const EDITOR_BUDGET = 140 * 1024;
/** Class names only CodeMirror's own code carries. */
const CM_MARKER = /cm-content|cm-gutters/;

/** The editor itself: not even a package's build may use these. */
const EDITOR_ONLY = [/^@codemirror\//, /^@lezer\//, /^lz-string$/];

const pkg = (path) => JSON.parse(readFileSync(path, "utf8"));
const depsOf = (p) => Object.keys({ ...p.dependencies, ...p.devDependencies, ...p.peerDependencies, ...p.optionalDependencies });
/** What a package's consumers install with it. */
const shippedOf = (p) => Object.keys({ ...p.dependencies, ...p.peerDependencies, ...p.optionalDependencies });

test("the editor's dependencies are in docs/package.json and in no published package", () => {
  const docs = depsOf(pkg(join(DOCS, "package.json")));
  for (const name of ["@codemirror/view", "@codemirror/lang-yaml", "lz-string", "fflate"]) {
    assert.ok(docs.includes(name), `docs/package.json lists ${name}`);
  }
  for (const dir of readdirSync(join(REPO, "packages"))) {
    const file = join(REPO, "packages", dir, "package.json");
    if (!existsSync(file)) continue;
    // (core bundles fflate at build time, a devDependency of its own; it
    // must still never become something consumers install.)
    const p = pkg(file);
    const leaked = [
      ...shippedOf(p).filter((d) => EDITOR_DEPS.some((re) => re.test(d))),
      ...depsOf(p).filter((d) => EDITOR_ONLY.some((re) => re.test(d))),
    ];
    assert.deepEqual([...new Set(leaked)], [], `packages/${dir}/package.json must not depend on the playground's editor`);
  }
});

const built = existsSync(join(DIST, "playground", "index.html"));
const skip = built ? false : "docs/dist has no playground page: build the docs first (pnpm build)";

/** Every built page, as a path under dist. */
function pages(dir = DIST, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "_astro") pages(p, out);
    } else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

const STATIC_IMPORT = /\b(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?["']\.\/([\w.-]+\.js)["']/g;
const DYNAMIC_IMPORT = /["'](?:\.\/|_astro\/)([\w.-]+\.js)["']/g;
const source = new Map();
const read = (chunk) => {
  if (!source.has(chunk)) source.set(chunk, readFileSync(join(ASTRO, chunk), "utf8"));
  return source.get(chunk);
};

/** The chunks a set of entry chunks load before running: their static imports, transitively. */
function staticClosure(entries) {
  const seen = new Set();
  const visit = (chunk) => {
    if (seen.has(chunk) || !existsSync(join(ASTRO, chunk))) return;
    seen.add(chunk);
    for (const m of read(chunk).matchAll(STATIC_IMPORT)) visit(m[1]);
  };
  entries.forEach(visit);
  return seen;
}

/** The scripts a page loads: every /_astro/*.js its HTML names. */
const entriesOf = (html) => [...new Set([...readFileSync(html, "utf8").matchAll(/\/_astro\/([\w.-]+\.js)/g)].map((m) => m[1]))];

test("no page but /playground/ loads CodeMirror, and /playground/ loads it lazily", { skip }, () => {
  const editorChunks = readdirSync(ASTRO).filter((f) => f.endsWith(".js") && CM_MARKER.test(read(f)));
  assert.ok(editorChunks.length > 0, "the build has an editor chunk");

  const offenders = [];
  let playgroundEntries = null;
  for (const html of pages()) {
    const page = "/" + relative(DIST, html).replace(/index\.html$/, "");
    const entries = entriesOf(html);
    if (page === "/playground/") playgroundEntries = entries;
    const loaded = staticClosure(entries);
    const cm = editorChunks.filter((c) => loaded.has(c));
    if (cm.length) offenders.push(`${page} loads ${cm.join(", ")}`);
    // A page that isn't the playground must not even name the editor chunk.
    if (page !== "/playground/") {
      const named = readFileSync(html, "utf8");
      for (const c of editorChunks) if (named.includes(c)) offenders.push(`${page} names ${c}`);
    }
  }
  assert.deepEqual(offenders, [], "the editor reaches no page statically (on /playground/ it must be a dynamic import)");

  // ...and the playground does reach it, through a dynamic import.
  const lazily = [...staticClosure(playgroundEntries)].some((chunk) =>
    [...read(chunk).matchAll(DYNAMIC_IMPORT)].some((m) => editorChunks.includes(m[1])),
  );
  assert.ok(lazily, "/playground/ imports the editor chunk dynamically");
});

test("the editor chunk is within its gzip budget", { skip }, () => {
  const editorChunks = readdirSync(ASTRO).filter((f) => f.endsWith(".js") && CM_MARKER.test(read(f)));
  for (const chunk of editorChunks) {
    const gz = gzipSync(read(chunk), { level: 9 }).length;
    assert.ok(gz <= EDITOR_BUDGET, `${chunk} is ${(gz / 1024).toFixed(1)} KB gzip, over the ${EDITOR_BUDGET / 1024} KB budget`);
  }
});
