/**
 * scripts/validate-doc-snippets.mjs checks the code readers copy from the
 * docs. Besides YAML it validates ```json and ```toml fences that are whole
 * documents, by the rule `mlym validate` uses to pick documents out of a
 * folder, and leaves every other JSON (GeoJSON, style.json, package.json)
 * alone. These tests run the script on planted files.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(REPO, "scripts", "validate-doc-snippets.mjs");
const GUIDE = join(REPO, "docs", "src", "content", "docs", "guides", "json-and-toml.mdx");
const skip = !existsSync(join(REPO, "packages", "core", "dist", "index.js")) && "core is not built";

const BASEMAP = "https://tiles.openfreemap.org/styles/liberty";
const fence = (lang, body) => "```" + lang + "\n" + body.trim() + "\n```\n";

/** Run the validator on one planted Markdown file; its exit status and output. */
function runOn(markdown) {
  const dir = mkdtempSync(join(tmpdir(), "doc-snippets-"));
  try {
    const file = join(dir, "page.md");
    writeFileSync(file, markdown);
    const run = spawnSync(process.execPath, [SCRIPT, file], { cwd: REPO, encoding: "utf8" });
    return { status: run.status, out: run.stdout + run.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a TOML document fence with a syntax error fails, with the TOML message", { skip }, () => {
  const { status, out } = runOn(
    "# Planted\n\n" +
      fence("toml", `
type = "map"
id = "broken"

[config]
center = [0, 0]
zoom = 1
mapStyle = "${BASEMAP}"

[[layers]]
id = "bg"
type = "background"
paint = { background-color = #fff }
`)
  );
  assert.equal(status, 1, out);
  assert.match(out, /page\.md \(snippet #0, fence at line 3\) \(TOML document\)/);
  assert.match(out, /TOML syntax error/);
});

test("a TOML document that parses but doesn't validate fails", { skip }, () => {
  const { status, out } = runOn(fence("toml", `type = "map"\nid = "no-config"\n`));
  assert.equal(status, 1, out);
  assert.match(out, /config/);
});

test("a JSON document fence is validated in JSON", { skip }, () => {
  const { status, out } = runOn(
    fence("json", `{\n  // a comment\n  "type": "map",\n  "id": "x"\n}`)
  );
  assert.equal(status, 1, out);
  assert.match(out, /\(JSON document\)/);
  assert.match(out, /comments are not allowed in JSON/);
});

test("JSON that is not a document, and TOML fragments, are skipped", { skip }, () => {
  const { status, out } = runOn(
    fence("json", `{ "type": "FeatureCollection", "features": [ broken ] }`) +
      fence("json", `{ "name": "my-site", "version": "1.0.0" }`) +
      fence("toml", `[layers.paint]\ncircle-color = #fff`) +
      fence("toml no-validate", `type = "map"\nfilter = null`)
  );
  assert.equal(status, 0, out);
  assert.match(out, /0 snippet\(s\) validated, 4 skipped/);
});

test("the JSON and TOML guide passes, its JSON and TOML documents included", { skip }, () => {
  const run = spawnSync(process.execPath, [SCRIPT, GUIDE], { cwd: REPO, encoding: "utf8" });
  const out = run.stdout + run.stderr;
  assert.equal(run.status, 0, out);
  // The YAML quick start, and the JSON, TOML, story and locale documents.
  const checked = Number(/(\d+) snippet\(s\) validated/.exec(out)?.[1]);
  assert.ok(checked >= 5, out);
});
