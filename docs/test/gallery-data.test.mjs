/**
 * The gallery's one list (src/data/gallery.mjs) agrees with the pages it
 * describes. The index tables and every gallery page's breadcrumb and
 * "Use this map" footer are drawn from it, and those links sit in
 * components, where the build's link checker doesn't look, so this checks
 * them instead.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GROUPS, START_HERE, allEntries, linksFor, census } from "../src/data/gallery.mjs";
import { inline } from "../src/components/gallery/inline.mjs";
import { PAGE_REDIRECTS } from "../redirects.mjs";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = join(DOCS, "src/content/docs");
const GALLERY = join(CONTENT, "examples/gallery");
const INDEX = readFileSync(join(GALLERY, "index.mdx"), "utf8");

const pages = readdirSync(GALLERY)
  .filter((f) => f.endsWith(".mdx") && f !== "index.mdx")
  .map((f) => f.replace(/\.mdx$/, ""));

/** Starlight's heading slug (github-slugger) for the plain-text headings used here. */
const slug = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");

/** The YAML reference pages the generator writes (git-ignored, so maybe not built yet). */
const GENERATED = new Set(["/reference/yaml/", "/reference/yaml/map/", "/reference/yaml/layers/", "/reference/yaml/sources/", "/reference/yaml/scrollytelling/"]);

/** Does a site path name a page that exists (or a redirect to one)? */
function pageExists(path) {
  if (PAGE_REDIRECTS[path]) return true;
  if (GENERATED.has(path)) return true;
  const rel = path.replace(/^\/|\/$/g, "");
  return [".md", ".mdx", "/index.md", "/index.mdx"].some((ext) => existsSync(join(CONTENT, rel + ext)));
}

/** Heading ids on a page's source: `## Text`, `## Text {#id}` and `## Text \{#id}`. */
function headingIds(path) {
  const rel = path.replace(/^\/|\/$/g, "");
  const file = [".md", ".mdx", "/index.md", "/index.mdx"].map((ext) => join(CONTENT, rel + ext)).find(existsSync);
  if (!file) return null; // generated and not built yet
  const ids = new Set();
  for (const m of readFileSync(file, "utf8").matchAll(/^#{2,6} (.+)$/gm)) {
    const explicit = m[1].match(/\\?\{#([^}]+)\}\s*$/);
    ids.add(explicit ? explicit[1] : slug(m[1].replace(/`/g, "")));
  }
  return ids;
}

test("every gallery page has exactly one entry, and every entry with a page has one", () => {
  const slugs = allEntries().filter((e) => e.slug).map((e) => e.slug);
  assert.equal(new Set(slugs).size, slugs.length, "a slug is listed twice");
  assert.deepEqual([...slugs].sort(), [...pages].sort());
});

test("entries without a page name a MapLibre example, once each", () => {
  const upstream = allEntries().filter((e) => !e.slug);
  for (const e of upstream) {
    assert.match(e.upstream, /^[a-z0-9-]+$/, e.title);
    assert.ok(e.note, `${e.title} has no page, so it needs a note saying what you would write`);
  }
  assert.equal(new Set(upstream.map((e) => e.upstream)).size, upstream.length);
});

test("the census adds up", () => {
  const c = census();
  assert.equal(c.upstreamPagesYaml + c.upstreamPagesYamlJs, c.upstreamWithPages);
  assert.equal(c.upstreamWithPages + c.ownPages, pages.length);
});

test("each group has its heading and its table on the index, in order", () => {
  const headings = [...INDEX.matchAll(/^## (.+)$/gm)].map((m) => slug(m[1]));
  const tables = [...INDEX.matchAll(/<GalleryGroup id="([^"]+)" \/>/g)].map((m) => m[1]);
  assert.deepEqual(tables, GROUPS.map((g) => g.id));
  for (const g of GROUPS) {
    assert.ok(headings.includes(g.id), `the index has no heading whose anchor is #${g.id}`);
    assert.equal(slug(g.title), g.id, `group ${g.id}'s title slugs to a different anchor`);
  }
});

test("start-here pages exist", () => {
  for (const { slug: s } of START_HERE) assert.ok(pages.includes(s), s);
});

test("every footer link lands on a page and heading that exist", () => {
  for (const entry of allEntries()) {
    const { guides, reference, see } = linksFor(entry);
    assert.ok(guides.length > 0 && reference.length > 0, `${entry.title}: no guide or reference link`);
    for (const { href } of [...guides, ...reference, ...see]) {
      const [path, hash] = href.split("#");
      assert.ok(pageExists(path), `${entry.title}: ${href} is not a page`);
      if (hash) {
        const ids = headingIds(path);
        if (ids) assert.ok(ids.has(hash), `${entry.title}: ${href} has no #${hash}`);
      }
    }
  }
});

test("notes stay reader-facing: no tracker ids, no release history", () => {
  for (const e of allEntries()) {
    const text = `${e.title} ${e.note ?? ""}`;
    assert.doesNotMatch(text, /\bml-(?!map\b)[a-z0-9]{3}\b|\bU\d{1,2}\b|\bD-A\d\b|plans\//, e.title);
    assert.doesNotMatch(text, /\b(since|before|in) 0\.\d/i, e.title);
  }
});

test("inline() renders code and links and escapes the rest", () => {
  assert.equal(
    inline("Use `<ml-map>` & [the guide](/guides/x/)"),
    'Use <code>&lt;ml-map&gt;</code> &amp; <a href="/guides/x/">the guide</a>',
  );
});
