/**
 * The React docs cannot drift from this app (D-A11).
 *
 * Every fenced block in the docs preceded by an MDX comment
 * `{/* snippet: examples/react/<path> *\/}` must equal that file byte for
 * byte. The files are real modules of this app, so they are type-checked
 * against @types/react 18 and 19 (`pnpm typecheck`), bundled for React 18 and
 * 19 (`pnpm build`), and driven in a browser (e2e/react-example.spec.ts).
 * The typings reference line the docs print must also be the one this app
 * uses in src/vite-env.d.ts.
 *
 * Run: `node --test tests/` (the package's `test` script, so `pnpm test`
 * and presubmit run it).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(APP, "..", "..");
const PAGES = [
  "docs/src/content/docs/integrations/web-components.mdx",
  "docs/src/content/docs/integrations/react.mdx",
];

/** [{ page, path, body }] for every snippet marker followed by a fence. */
function markedSnippets() {
  const out = [];
  for (const page of PAGES) {
    const mdx = readFileSync(join(REPO, page), "utf8");
    const re = /\{\/\* snippet: (\S+) \*\/\}\n```[a-z]*\n([\s\S]*?)```/g;
    for (const m of mdx.matchAll(re)) out.push({ page, path: m[1], body: m[2] });
  }
  return out;
}

const docsPresent = PAGES.every((p) => existsSync(join(REPO, p)));

test("docs React snippets are files of this app, verbatim", { skip: !docsPresent }, () => {
  const snippets = markedSnippets();
  assert.ok(snippets.length >= 4, `expected the React snippets to be marked; found ${snippets.length}`);
  for (const { page, path, body } of snippets) {
    assert.ok(path.startsWith("examples/react/"), `${page}: snippet ${path} is not in examples/react`);
    const file = join(REPO, path);
    assert.ok(existsSync(file), `${page}: snippet source ${path} does not exist`);
    assert.equal(
      body,
      readFileSync(file, "utf8"),
      `${page}: the snippet marked ${path} differs from the file. Edit the file, then paste it into the docs.`
    );
  }
});

test("every docs ```tsx block on the React parts of the pages is a checked snippet", { skip: !docsPresent }, () => {
  // An unmarked React fence would be unchecked prose code: the drift this
  // guards against. web-components.mdx: the "### React" section up to
  // "#### Next.js" (the Next.js snippet needs a server and is verified
  // separately); react.mdx: the whole page.
  const wc = readFileSync(join(REPO, PAGES[0]), "utf8");
  const start = wc.indexOf("### React\n");
  const end = wc.indexOf("#### Next.js");
  assert.ok(start > 0 && end > start, "the React section moved; update this test with it");
  for (const [page, text] of [
    [PAGES[0], wc.slice(start, end)],
    [PAGES[1], readFileSync(join(REPO, PAGES[1]), "utf8")],
  ]) {
    const fences = [...text.matchAll(/(^.*\n)?```tsx\n/gm)];
    for (const f of fences) {
      const marked = /\{\/\* snippet: /.test(f[1] ?? "");
      // The two-line entry-point imports on react.mdx are not a component.
      const entryImports = text
        .slice(f.index + (f[1]?.length ?? 0))
        .startsWith("```tsx\n// src/main.tsx\n");
      assert.ok(
        marked || entryImports,
        `${page}: a \`\`\`tsx block is not marked {/* snippet: examples/react/... */}`
      );
    }
  }
});

test("the documented typings reference is the one the app uses", { skip: !docsPresent }, () => {
  const line = '/// <reference types="@maplibre-yaml/core/react" />';
  assert.ok(readFileSync(join(APP, "src/vite-env.d.ts"), "utf8").includes(line));
  for (const page of PAGES) {
    assert.ok(readFileSync(join(REPO, page), "utf8").includes(line), `${page} lost the typings line`);
  }
});
