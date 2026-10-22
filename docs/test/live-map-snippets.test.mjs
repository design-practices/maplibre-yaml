/**
 * A live map drawn next to a YAML sample must draw that sample (docs/STYLE.md,
 * "Code samples"). For each page listed here, every `<LiveMap src="/configs/…">`
 * must have a ```yaml fence on the same page whose text is the config file's,
 * minus the schema modeline. Add a page to PAGES once its demos and samples
 * agree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = join(DOCS, "src/content/docs");

const PAGES = [
  "index.mdx",
  "getting-started/quick-start.mdx",
  "getting-started/first-map.mdx",
];

/** The ```yaml fences of a page, de-indented, without their info strings. */
function yamlFences(text) {
  const out = [];
  const re = /^([ \t]*)```yaml[^\n]*\n([\s\S]*?)^\1```[ \t]*$/gm;
  for (const m of text.matchAll(re)) {
    const indent = m[1].length;
    out.push(
      m[2]
        .split("\n")
        .map((l) => l.slice(Math.min(indent, l.length - l.trimStart().length)))
        .join("\n")
    );
  }
  return out;
}

/** A config file as a reader would see it: the editor modeline removed. */
function shownText(file) {
  return readFileSync(join(DOCS, "public", file), "utf8")
    .split("\n")
    .filter((l) => !l.startsWith("# yaml-language-server:"))
    .join("\n");
}

const norm = (s) => s.replace(/\s+$/, "") + "\n";

for (const page of PAGES) {
  test(`${page}: every live map draws a sample shown on the page`, () => {
    const text = readFileSync(join(CONTENT, page), "utf8");
    const demos = [...text.matchAll(/<LiveMap[^>]*\bsrc="\/(configs\/[^"]+\.yaml)"/g)].map((m) => m[1]);
    assert.ok(demos.length > 0, `${page} has no live map`);
    const fences = yamlFences(text).map(norm);
    for (const demo of demos) {
      const shown = norm(shownText(demo));
      assert.ok(
        fences.includes(shown),
        `${page}: no yaml fence matches ${demo} — the live map draws something the page doesn't show`
      );
    }
  });
}
